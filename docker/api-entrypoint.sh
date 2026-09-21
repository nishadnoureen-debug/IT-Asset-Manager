#!/bin/sh
# Hosted disks (Render, some volume drivers) are mounted owned by root. Give the app user its storage
# directory, then drop root before running anything else.
set -e
dir="${STORAGE_LOCAL_DIR:-/data/storage}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$dir"
  chown app:app "$dir"
  exec su-exec app "$@"
fi
exec "$@"
