import os
import subprocess as sp
from subprocess import run, check_output

name = "web"
sp.run("tar -czf backup.tgz data/ && echo done", shell=True, check=True)
run(["git", "log", "--oneline", "-n", "5"], check=True)
out = check_output(f"docker ps --filter name={name} | grep -c Up", shell=True)
os.system("ls *.log | xargs -n 1 gzip")
sp.run("ls -l")
sp.run("grep -r TODO src "
       "| wc -l", shell=True)
script = """
set -e
for f in *.txt; do echo "$f"; done
"""
print("not a command: ls -l")  # os.system("rm -rf /") in a comment
sp.Popen(["ssh", host, 'echo "it\'s up"'])
