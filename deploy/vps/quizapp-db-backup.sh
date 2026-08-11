#!/bin/sh
set -eu

umask 077
backup_dir=/opt/quizapp/backups
mkdir -p "$backup_dir"
backup_file="$backup_dir/local-postgres-$(date +%Y%m%d-%H%M%S).dump"

runuser -u postgres -- pg_dump --format=custom --no-owner --no-acl --file="$backup_file" quizapp
runuser -u postgres -- pg_restore --list "$backup_file" >/dev/null
find "$backup_dir" -maxdepth 1 -type f -name 'local-postgres-*.dump' -mtime +7 -delete
