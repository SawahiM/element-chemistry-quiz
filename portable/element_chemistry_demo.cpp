#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <winsock2.h>
#include <ws2tcpip.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

namespace fs = std::filesystem;

namespace {

SOCKET server_socket = INVALID_SOCKET;

bool send_all(SOCKET socket, const char* data, std::size_t size) {
    while (size > 0) {
        const int chunk = send(socket, data, static_cast<int>(std::min<std::size_t>(size, 1 << 20)), 0);
        if (chunk <= 0) return false;
        data += chunk;
        size -= static_cast<std::size_t>(chunk);
    }
    return true;
}

void send_text(SOCKET socket, int status, const char* reason, const std::string& body) {
    std::ostringstream headers;
    headers << "HTTP/1.1 " << status << ' ' << reason << "\r\n"
            << "Content-Type: text/plain; charset=utf-8\r\n"
            << "Content-Length: " << body.size() << "\r\n"
            << "Connection: close\r\n\r\n";
    const std::string header_text = headers.str();
    send_all(socket, header_text.data(), header_text.size());
    send_all(socket, body.data(), body.size());
}

std::string mime_type(const fs::path& path) {
    std::string extension = path.extension().string();
    std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char value) {
        return static_cast<char>(std::tolower(value));
    });
    if (extension == ".html") return "text/html; charset=utf-8";
    if (extension == ".css") return "text/css; charset=utf-8";
    if (extension == ".js" || extension == ".mjs") return "text/javascript; charset=utf-8";
    if (extension == ".json") return "application/json; charset=utf-8";
    if (extension == ".svg") return "image/svg+xml";
    if (extension == ".jpeg" || extension == ".jpg") return "image/jpeg";
    if (extension == ".png") return "image/png";
    if (extension == ".woff2") return "font/woff2";
    if (extension == ".woff") return "font/woff";
    if (extension == ".ttf") return "font/ttf";
    if (extension == ".sqlite") return "application/vnd.sqlite3";
    return "application/octet-stream";
}

bool safe_request_path(const std::string& path) {
    return path.find("..") == std::string::npos &&
           path.find('\\') == std::string::npos &&
           path.find('%') == std::string::npos &&
           !path.empty() && path.front() == '/';
}

void serve_file(SOCKET socket, const fs::path& path, bool head_only) {
    std::error_code error;
    const auto size = fs::file_size(path, error);
    if (error || !fs::is_regular_file(path)) {
        send_text(socket, 404, "Not Found", "Not found");
        return;
    }

    std::ostringstream headers;
    headers << "HTTP/1.1 200 OK\r\n"
            << "Content-Type: " << mime_type(path) << "\r\n"
            << "Content-Length: " << size << "\r\n"
            << "Cache-Control: "
            << (path.extension() == ".json" || path.extension() == ".html"
                    ? "no-cache"
                    : "public, max-age=31536000, immutable")
            << "\r\nConnection: close\r\n\r\n";
    const std::string header_text = headers.str();
    if (!send_all(socket, header_text.data(), header_text.size()) || head_only) return;

    std::ifstream input(path, std::ios::binary);
    std::vector<char> buffer(1 << 20);
    while (input) {
        input.read(buffer.data(), static_cast<std::streamsize>(buffer.size()));
        const auto count = input.gcount();
        if (count > 0 && !send_all(socket, buffer.data(), static_cast<std::size_t>(count))) break;
    }
}

void handle_client(SOCKET socket, fs::path resource_root) {
    std::string request;
    std::vector<char> buffer(8192);
    while (request.find("\r\n\r\n") == std::string::npos && request.size() < 65536) {
        const int count = recv(socket, buffer.data(), static_cast<int>(buffer.size()), 0);
        if (count <= 0) break;
        request.append(buffer.data(), static_cast<std::size_t>(count));
    }

    std::istringstream first_line(request.substr(0, request.find("\r\n")));
    std::string method;
    std::string target;
    std::string version;
    first_line >> method >> target >> version;
    if (method != "GET" && method != "HEAD") {
        send_text(socket, 405, "Method Not Allowed", "Only GET and HEAD are supported");
        closesocket(socket);
        return;
    }

    const auto query = target.find_first_of("?#");
    if (query != std::string::npos) target.resize(query);
    if (!safe_request_path(target)) {
        send_text(socket, 400, "Bad Request", "Invalid path");
        closesocket(socket);
        return;
    }

    fs::path file;
    if (target == "/") {
        file = resource_root / "site" / "index.html";
    } else if (target.rfind("/page-images/", 0) == 0) {
        file = resource_root / "page-images" / target.substr(std::string("/page-images/").size());
    } else {
        file = resource_root / "site" / target.substr(1);
    }
    serve_file(socket, file, method == "HEAD");
    shutdown(socket, SD_BOTH);
    closesocket(socket);
}

fs::path executable_directory() {
    std::vector<wchar_t> path(32768);
    const DWORD length = GetModuleFileNameW(nullptr, path.data(), static_cast<DWORD>(path.size()));
    return fs::path(std::wstring(path.data(), length)).parent_path();
}

BOOL WINAPI console_handler(DWORD signal) {
    if (signal == CTRL_C_EVENT || signal == CTRL_CLOSE_EVENT || signal == CTRL_BREAK_EVENT) {
        if (server_socket != INVALID_SOCKET) closesocket(server_socket);
    }
    return FALSE;
}

}  // namespace

int main(int argc, char** argv) {
    SetConsoleOutputCP(CP_UTF8);
    SetConsoleCtrlHandler(console_handler, TRUE);

    const fs::path resource_root = executable_directory() / "resources";
    if (!fs::is_regular_file(resource_root / "site" / "index.html") ||
        !fs::is_directory(resource_root / "page-images")) {
        MessageBoxW(nullptr, L"未找到 resources 资源目录。请完整解压 Demo 后再运行。", L"元素化学题库", MB_OK | MB_ICONERROR);
        return 2;
    }

    WSADATA winsock_data{};
    if (WSAStartup(MAKEWORD(2, 2), &winsock_data) != 0) return 3;
    server_socket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (server_socket == INVALID_SOCKET) {
        WSACleanup();
        return 4;
    }

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = 0;
    if (bind(server_socket, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR ||
        listen(server_socket, SOMAXCONN) == SOCKET_ERROR) {
        MessageBoxW(nullptr, L"本地网页服务启动失败。", L"元素化学题库", MB_OK | MB_ICONERROR);
        closesocket(server_socket);
        WSACleanup();
        return 5;
    }

    int address_length = sizeof(address);
    getsockname(server_socket, reinterpret_cast<sockaddr*>(&address), &address_length);
    const unsigned short port = ntohs(address.sin_port);
    const std::wstring url = L"http://127.0.0.1:" + std::to_wstring(port) + L"/";

    const bool no_open = argc > 1 && std::string(argv[1]) == "--no-open";
    std::cout << "元素化学颜色题库 Demo 已启动" << std::endl;
    std::cout << "URL=http://127.0.0.1:" << port << "/" << std::endl;
    std::cout << "关闭此窗口即可停止。" << std::endl;
    if (!no_open) ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);

    while (true) {
        sockaddr_in client_address{};
        int client_length = sizeof(client_address);
        const SOCKET client = accept(server_socket, reinterpret_cast<sockaddr*>(&client_address), &client_length);
        if (client == INVALID_SOCKET) break;
        std::thread(handle_client, client, resource_root).detach();
    }

    closesocket(server_socket);
    WSACleanup();
    return 0;
}
