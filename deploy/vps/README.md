# VPS production deployment

The `main` branch targets a single VPS deployment with PostgreSQL bound to
`127.0.0.1`. Runtime credentials belong in `/etc/quizapp.env` and must not be
committed. The application release is selected by `/opt/quizapp/current`.

Install the application service and Nginx configuration from this directory.
Database backups are provided by the VPS provider rather than an application
timer.

Set `DATABASE_URL` to the loopback PostgreSQL 17 instance and set
`CHEMQUIZ_TRUST_PROXY=1`. The application rejects non-loopback database hosts;
Nginx overwrites forwarded client-IP headers before login events are recorded.
