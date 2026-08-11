# VPS production deployment

The `main` branch targets a single VPS deployment with PostgreSQL bound to
`127.0.0.1`. Runtime credentials belong in `/etc/quizapp.env` and must not be
committed. The application release is selected by `/opt/quizapp/current`.

Install the service, Nginx configuration, and database backup units from this
directory. `quizapp-db-backup.timer` keeps daily custom-format PostgreSQL dumps
for seven days under `/opt/quizapp/backups`.
