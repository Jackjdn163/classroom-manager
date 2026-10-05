#!/bin/bash
# Starts the app at http://localhost:8000 and opens it in your browser.
cd "$(dirname "$0")"
(sleep 1 && open "http://localhost:8000") &
echo "Classroom Priorities running at http://localhost:8000 (press Ctrl+C to stop)"
python3 -m http.server 8000 --bind 127.0.0.1
