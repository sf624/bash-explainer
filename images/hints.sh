#!/usr/bin/env bash
# Archive the logs of a service.
alias ls='ls --color=auto'
cd() { builtin cd "$@" && echo "now in $PWD"; }

enable -n echo
cd /var/log/myapp
for f in $(ls *.log); do
  gzip -c "$f" > "/archive/$f.gz"
done
sudo cd /root
echo "done"
