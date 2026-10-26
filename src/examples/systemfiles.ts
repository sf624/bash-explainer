// Sample contents of well-known system files, in their own formats, for the worked examples of the commands that read
// them (`cut -d: -f1,7 /etc/passwd`): lines a reader recognises, instead of made-up ones. The formats are those of
// passwd(5), group(5), shadow(5), hosts(5) and fstab(5); the names, numbers and hashes are made up.

/** The sample lines of each file, by its path. */
export const SYSTEM_FILES: Readonly<Record<string, readonly string[]>> = {
  // name:password:UID:GID:GECOS:home:shell
  '/etc/passwd': [
    'root:x:0:0:root:/root:/bin/bash',
    'daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin',
    'nobody:x:65534:65534:nobody:/nonexistent:/usr/sbin/nologin',
    'alice:x:1000:1000:Alice:/home/alice:/bin/bash',
    'bob:x:1001:1001:Bob:/home/bob:/bin/zsh',
  ],
  // group_name:password:GID:user_list
  '/etc/group': [
    'root:x:0:',
    'sudo:x:27:alice',
    'docker:x:999:alice,bob',
    'alice:x:1000:',
  ],
  // name:password:last change:min:max:warn:inactive:expire:reserved (`*` and `!`: no password login)
  '/etc/shadow': [
    'root:*:19700:0:99999:7:::',
    'daemon:*:19700:0:99999:7:::',
    'alice:$y$j9T$Fz3eQ1$Lp0aVxk9:19800:0:99999:7:::',
    'bob:!:19810:0:99999:7:::',
  ],
  // address, then the canonical name and the aliases, separated by blanks
  '/etc/hosts': [
    '127.0.0.1       localhost',
    '127.0.1.1       myhost.example.org myhost',
    '192.168.1.10    server1.example.org server1',
    '::1             localhost ip6-localhost ip6-loopback',
  ],
  // device, mount point, type, options, dump, pass
  '/etc/fstab': [
    'UUID=4f1c2a7e-91d3-4b0e-8c55-2e6a9d0b7f13 / ext4 errors=remount-ro 0 1',
    'UUID=7A3B-1C2D /boot/efi vfat umask=0077 0 1',
    '/swapfile none swap sw 0 0',
    'tmpfs /tmp tmpfs defaults,size=2G 0 0',
  ],
};

/** The sample lines of the system file `name`, when it is one of them. */
export function systemFileLines(name: string): string[] | undefined {
  return Object.hasOwn(SYSTEM_FILES, name) ? [...SYSTEM_FILES[name]] : undefined;
}
