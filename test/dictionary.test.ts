import * as assert from 'assert';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { builtins } from '../src/dict/builtins';
import { commands, core } from '../src/dict/commands';
import { distro } from '../src/dict/distro';
import { system } from '../src/dict/system';
import { basic } from '../src/dict/basic';
import { storage } from '../src/dict/storage';
import { admin } from '../src/dict/admin';
import { netadmin } from '../src/dict/netadmin';
import { monitor } from '../src/dict/monitor';
import { macos } from '../src/dict/macos';
import { ops } from '../src/dict/ops';
import { extraFiles } from '../src/dict/extrasFiles';
import { extraAdmin } from '../src/dict/extrasAdmin';
import { extraSubcommands } from '../src/dict/extras';
import { cmd } from '../src/dict/types';
import type { CommandSpec, OptionSpec, ValueSpec } from '../src/argv/spec';
import { interpret } from '../src/argv/interpret';
import { YQ_SPECS } from '../src/dict/yq';
import { tx } from '../src/i18n';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function tokens(src: string, lang: 'en' | 'ja' = 'en'): Token[] {
  const tree = parser.parse(src);
  const out: Token[] = [];
  const walk = (t: Token) => (out.push(t), t.children.forEach(walk));
  new Analyzer(lang).explainLine(tree, 0).items.forEach(walk);
  return out;
}

const unknown = (src: string) => tokens(src).filter((t) => /not in the dictionary/.test(t.explanation)).map((t) => t.label);

/** Every spec of the dictionary, with its subcommands (and find's expression), by its path (`git remote add`). */
function everySpec(visit: (path: string, spec: CommandSpec) => void): void {
  const walk = (path: string, spec: CommandSpec): void => {
    visit(path, spec);
    if (spec.expressionSpec) walk(`${path} (expression)`, spec.expressionSpec);
    for (const [name, sub] of Object.entries(spec.subcommands ?? {})) walk(`${path} ${name}`, sub);
  };
  for (const [name, spec] of [...Object.entries(commands), ...Object.entries(builtins), ...Object.entries(YQ_SPECS).map(([f, d]) => [`yq (${f})`, d] as const)]) walk(name, spec);
}

describe('the dictionary', () => {
  // Lines as they appear in installers, official Docker images and CI images: the commands and
  // options a survey of those repositories found most often that the dictionary did not know.
  const lines = [
    'apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*',
    'apt-get purge -y --auto-remove -o APT::AutoRemove::RecommendsImportant=false',
    'savedAptMark="$(apt-mark showmanual)"',
    'dpkgArch="$(dpkg --print-architecture)"',
    'gnuArch="$(dpkg-architecture --query DEB_BUILD_GNU_TYPE)"',
    'dpkg-query -W -f=\'${Package} ${Version}\\n\'',
    'apk add --no-cache --virtual .build-deps gcc make',
    'apk del --no-network .build-deps',
    'arch="$(apk --print-arch)"',
    'dnf install -y --setopt=install_weak_deps=False --nodocs git',
    'microdnf install -y tar && microdnf clean all',
    'brew install --cask iterm2',
    'pip install --no-cache-dir -r requirements.txt',
    'yarn install --frozen-lockfile',
    'case "$(uname -s)" in',
    'machine="$(uname -m)"',
    'USER="$(id -un)"',
    'useradd -r -u 999 -g mysql -l -s /usr/sbin/nologin mysql',
    'groupadd --system --gid 999 mysql',
    'addgroup -g 1000 app && adduser -h /app -s /bin/sh -G app -D -H -u 1000 app',
    'getent passwd "$uid"',
    'make -j"$(nproc)"',
    'jobs="$(getconf _NPROCESSORS_ONLN)"',
    'gpg --batch --keyserver hkps://keyserver.ubuntu.com --recv-keys B42F6819007F00F88E364FD4036A9C25BF357DD4',
    'curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg',
    'gpg --batch --verify python.tar.xz.asc python.tar.xz',
    'gpgconf --kill all',
    'pass="$(openssl rand -base64 24)"',
    'openssl x509 -in cert.pem -noout -enddate',
    'echo "$sum  file" | sha512sum -c -',
    'shasum -a 256 file',
    'xzcat dump.sql.xz | head',
    'zstd -dc dump.sql.zst',
    'patch -p1 < fix.patch',
    'systemctl enable --now docker',
    'systemctl -q is-active nginx',
    'sysctl -n hw.memsize',
    'os=$(sw_vers -productVersion)',
    'lsb_release -cs',
    'mountpoint -q /var/lib/postgresql/data',
    'ldd --version',
    'go build -o bin/app -ldflags "-s -w" ./cmd/app',
    'go test -v -race ./...',
    'go list -m -json all',
    'cargo install --locked cargo-audit',
    'rustup component add rustfmt clippy',
    'node --version',
    'gh api repos/owner/repo/releases/latest --jq .tag_name',
    'gh workflow run build.yml --repo owner/repo',
    'shellcheck -x -e SC2086 script.sh',
    'gofmt -l .',
    'set -Eeuo pipefail',
    'test -z "$x"',
    'complete -F _app app',
    'tail -1 log && head -20 log',
    'git log -1 --format=%H',
    'git diff --exit-code',
    'git fetch --depth 1 --tags -q origin',
    'tar -xf go.tgz -C /usr/local --strip-components=1',
    'curl -fsSL --retry 3 --compressed "$url"',
    'jq -sRc . file',
    'jq -n --argjson n 1 \'$n\'',
    'docker ps -f label=app --format "{{.ID}}"',
    'docker build --build-arg VERSION=1 -t app .',
    'echo "$TOKEN" | docker login -u user --password-stdin ghcr.io',
    "sed -i.bak 's/a/b/' file",
    // From a second survey: operations, cloud, node bootstrap and dotfiles.
    'kubectl get pods -n kube-system -o wide',
    'kubectl rollout status deploy/web --timeout 120s',
    'helm upgrade --install web ./chart -n prod --create-namespace -f values.yaml',
    'kustomize build overlays/prod | kubectl apply -f -',
    'kind create cluster --name e2e --config kind.yaml',
    'terraform apply -auto-approve -var-file=prod.tfvars',
    'aws s3 sync ./dist s3://bucket/ --delete --region us-east-1',
    'gcloud container clusters get-credentials c --zone z --project p',
    'envsubst < job.yaml | kubectl apply -f -',
    'docker buildx build --platform linux/amd64,linux/arm64 -t img --push .',
    'docker system prune -a -f',
    'docker inspect --format "{{.State.Status}}" web',
    'podman run --rm -it alpine sh',
    'gh pr create --title t --body b --base main --head x --label bug',
    'git submodule update --init --recursive',
    'git symbolic-ref -q --short HEAD',
    'git tag -l --sort=-v:refname',
    'comm -23 expected actual',
    'usermod -aG docker "$USER"',
    "ssh-keygen -t ed25519 -N '' -f key",
    'ssh-keyscan github.com >> ~/.ssh/known_hosts',
    'dd if=/dev/zero of=disk.img bs=1M count=100',
    'lsblk -f -o NAME,FSTYPE,MOUNTPOINT',
    'blkid -s UUID -o value /dev/sda1',
    'modprobe nvidia',
    'iptables-save > rules.txt',
    'defaults write -g ApplePressAndHoldEnabled -bool false',
    'echo "1.5*2" | bc -l',
    'pnpm i --frozen-lockfile',
    'go test -count=1 -json ./...',
    'curl --retry 3 --retry-delay 2 --connect-timeout 5 -fsSL "$url"',
  ];
  for (const line of lines) {
    it(`knows ${line.length > 60 ? line.slice(0, 57) + '…' : line}`, () => assert.deepStrictEqual(unknown(line), []));
  }

  it('reads -N as -n N for head, tail and git log', () => {
    const tail = tokens('tail -1 log').find((t) => t.label === '-1')!;
    assert.match(tail.explanation, /^1 line \(old way to write `-n 1`\)$/);
    assert.match(tokens('head -20 log').find((t) => t.label === '-20')!.explanation, /^20 lines/);
    assert.match(tokens('git log -3').find((t) => t.label === '-3')!.explanation, /^only 3 \(same as `-n 3`\)$/);
  });

  it('takes the rest of sed -i.bak as the backup suffix', () => {
    const value = tokens("sed -i.bak 's/a/b/' f").find((t) => t.label === '.bak');
    assert.ok(value, 'no token for .bak');
    assert.match(value.explanation, /Value `\.bak` for `-i`/);
  });

  it('reads -name=value for commands with single-dash long options', () => {
    const t = tokens('terraform plan -var-file=prod.tfvars').find((x) => x.label === '-var-file=prod.tfvars')!;
    assert.match(t.explanation, /variables file .* \(value: `prod\.tfvars`\)/);
  });

  it('treats gawk and mawk as awk', () => {
    assert.match(tokens("gawk '{ print $1 }' f")[0].explanation, /Pattern-scanning language/);
  });

  it('explains the commands that distributions install by default, with their options', () => {
    const flock = tokens("flock -n /tmp/l -c 'x'");
    assert.match(flock[0].explanation, /holding a lock/);
    assert.match(flock.find((t) => t.label === '-n')!.explanation, /fail instead of waiting/);
    assert.match(flock.find((t) => t.label === '/tmp/l')!.explanation, /lock file/);
    const journal = tokens('journalctl -u nginx -f');
    assert.match(journal.find((t) => t.label === '-u')!.explanation, /only the given unit/);
    assert.match(journal.find((t) => t.label === 'nginx')!.explanation, /Value for `-u`/);
    assert.match(journal.find((t) => t.label === '-f')!.explanation, /follow new entries/);
    const ping = tokens('ping -c 3 example.com');
    assert.match(ping.find((t) => t.label === '3')!.explanation, /Value for `-c`/);
    assert.match(ping.find((t) => t.label === 'example.com')!.explanation, /host name/);
    assert.match(tokens('mkfs.ext4 -L data /dev/sdb1')[0].explanation, /ext4 file system/);
    assert.match(tokens('vim -c q f')[0].explanation, /Text editor/);
    for (const c of ['setsid', 'stdbuf', 'ionice', 'unshare', 'nsenter']) assert.ok(commands[c].operands![0].pattern.some((o) => o.command), c);
    assert.deepStrictEqual(unknown('flock -n /tmp/l ls; ping -c 1 h; dig +short a.com; chattr +i f'), []);
  });

  it('knows the commands the LPIC and LinuC objectives and everyday use name', () => {
    const lines = [
      // help, files, who, power
      'man -k copy; whatis ls; apropos disk; info coreutils; whereis -b ls; tree -L 2 -a; more -d f',
      'locate -i foo; updatedb; w -h; last -n 5 -x; lastlog -u root; shutdown -r +10; reboot; halt -p; poweroff; init 3; telinit q; runlevel',
      'traceroute -n h; tracepath -n h; cal -3; clear; reset; chroot /mnt /bin/sh; factor 12; dc -e "2 3 + p"; /usr/bin/time -v ls',
      // disks, file systems, LVM, RAID
      'fdisk -l; gdisk -l /dev/sda; parted -s /dev/sdb mklabel gpt; e2fsck -f /dev/sdb1; tune2fs -l /dev/sdb1; xfs_repair -n /dev/sdb1; mke2fs -t ext4 /dev/sdb1',
      'pvcreate /dev/sdb1; vgcreate vg0 /dev/sdb1; lvcreate -L 10G -n data vg0; lvextend -r -L +5G /dev/vg0/data; lvs; vgs; pvs; mdadm --create /dev/md0 -l 1 -n 2 /dev/sdb /dev/sdc',
      'cryptsetup open /dev/sdb1 c; smartctl -H /dev/sda; hdparm -I /dev/sda; lsblk -f; lspci -k; lsusb -t; exportfs -ra; showmount -e srv; nfsstat -s; mount.cifs //s/x /mnt',
      // boot, kernel, packages
      'grub-install /dev/sda; grub-mkconfig -o /boot/grub/grub.cfg; update-grub; efibootmgr -v; dracut -f; mkinitramfs -o /boot/i; depmod -a; insmod x.ko; rmmod x; modinfo -d x',
      'udevadm info -a -n /dev/sda; systemctl list-units --type=service; systemctl set-default multi-user.target; systemd-run --scope ls; chkconfig --list; update-rc.d x defaults',
      'apt-cache search foo; apt-file search x; dpkg-reconfigure tzdata; dpkg -c a.deb; rpm -qa; rpm -ivh a.rpm; rpm2cpio a.rpm | cpio -idv; zypper in x; yum provides x; dnf history; yumdownloader x',
      // accounts, scheduling, time, logs, mail, printing
      'groupdel g; groupmod -n n o; chage -l u; newgrp g; htpasswd -c f u; ldapsearch -x -b dc=x; at now + 5 minutes; atq; atrm 1; hwclock --systohc; tzselect; chronyc tracking',
      'logrotate -f /etc/logrotate.conf; systemd-cat ls; mail -s s a@b; mailq; newaliases; postfix reload; postconf -n; doveadm user "*"; lpr -P p f; lpq; lprm 1; lpstat -p',
      // network and servers
      'nmcli device status; ifup eth0; ifdown eth0; route -n; arp -a; ping6 -c1 h; ethtool eth0; nc -zv h 22; nmap -sV h; tcpdump -i any -nn port 80; mtr -r h; telnet h 25',
      'apachectl configtest; nginx -t; rndc reload; named-checkconf; named-checkzone x.com f; dnssec-keygen -a RSASHA256 x.com; smbclient -L h; testparm -s; smbstatus; openvpn --config c; sshd -t; ufw allow 22/tcp; firewall-cmd --list-all',
      'xhost +local:; xauth list; startx; setenforce 0; sestatus; restorecon -Rv /x; semanage port -l; auditctl -l; ausearch -k k; fail2ban-client status',
      // monitoring, virtualization, build
      'iostat -x 1; vmstat 1; sar -u 1 3; mpstat -P ALL; pidstat -p 1; htop -u u; strace -f -p 1; ltrace ls; lshw -short; dmidecode -t memory; ipcs -m',
      'virsh list --all; virt-install --name x; qemu-img create -f qcow2 a 1G; ansible all -m ping; ansible-playbook -C p.yml; ./configure --prefix=/opt; cmake -S . -B b; pkg-config --cflags x; objdump -d a; nm -D a',
      // macOS
      'open -a Safari x; pbcopy < f; pbpaste; say -v Kyoko hi; caffeinate -dimsu; diskutil list; hdiutil attach x.dmg; launchctl bootout gui/501 x.plist; scutil --get HostName; networksetup -listallnetworkservices',
      'softwareupdate -l; mdfind -name x; mdls f; ditto a b; xattr -d com.apple.quarantine f; codesign -dv a; spctl -a a; plutil -p f; sips -Z 800 a.png; pmset -g; system_profiler SPHardwareDataType; sw_vers',
      'dscl . -list /Users; dscacheutil -flushcache; defaults read com.apple.dock; otool -L a; lipo -info a; tmutil listbackups; security find-generic-password -s s; csrutil status; screencapture -x a.png; xcodebuild -list',
    ];
    for (const line of lines) assert.deepStrictEqual(unknown(line), [], line);
  });

  it('explains options added to older commands, also after a subcommand', () => {
    assert.match(tokens('ls -i --group-directories-first').find((t) => t.label === '-i')!.explanation, /inode/);
    assert.match(tokens('systemctl status -l nginx').find((t) => t.label === '-l')!.explanation, /ellipsize/);
    assert.match(tokens('systemctl list-unit-files --state=enabled')[0].explanation, /Control systemd/);
    // ip reads its options only before the object (test/subcommands-real.test.ts runs it).
    assert.match(tokens('ip -s addr show').find((t) => t.label === '-s')!.explanation, /statistics/);
    assert.match(tokens('ip addr show -s').find((t) => t.label === '-s')!.explanation, /not in the dictionary/);
    // kubectl's global options are its subcommands' too (kubernetes.io: `kubectl config view`, "Options inherited
    // from parent commands"), and `logs` keeps its own `-f`.
    assert.match(tokens('kubectl config view -o json').find((t) => t.label === '-o')!.explanation, /output format/);
    assert.match(tokens('kubectl config --kubeconfig k.yaml view').find((t) => t.label === '--kubeconfig')!.explanation, /kubeconfig file/);
    assert.match(tokens('kubectl logs -f web').find((t) => t.label === '-f')!.explanation, /stream/);
    assert.match(tokens('kubectl logs -k web').find((t) => t.label === '-k')!.explanation, /not in the dictionary/);
    assert.match(tokens('docker compose logs -p proj -f web').find((t) => t.label === '-p')!.explanation, /project name/);
    assert.match(tokens('docker compose run -p 80:80 web').find((t) => t.label === '-p')!.explanation, /publish|port/i);
    assert.match(tokens('ulimit -Hn 4096').find((t) => t.label === '-H')!.explanation, /hard limit/);
    assert.match(tokens('tar --zstd -cf a.tar.zst d').find((t) => t.label === '--zstd')!.explanation, /zstd/);
    assert.match(tokens('pkill -HUP -u root nginx').find((t) => t.label === '-HUP')!.explanation, /SIGHUP/);
    assert.match(tokens('screen -dmS web').find((t) => t.label === '-dmS')!.explanation, /detached/);
  });

  it('describes every command and option in both languages', () => {
    everySpec((name, d) => {
      assert.ok(d.summary.ja.trim() && d.summary.en.trim(), `${name}: summary`);
      for (const o of d.options ?? []) assert.ok(o.text.ja.trim() && o.text.en.trim(), `${name} ${o.names[0]}`);
    });
  });

  it('defines each command in one base table only, and extras only for commands that exist', () => {
    const tables = { core, distro, system, basic, storage, admin, netadmin, monitor, macos, ops };
    const where = new Map<string, string[]>();
    for (const [table, entries] of Object.entries(tables)) {
      for (const name of Object.keys(entries)) where.set(name, [...(where.get(name) ?? []), table]);
    }
    const twice = [...where].filter(([, t]) => t.length > 1).map(([n, t]) => `${n} (${t.join(', ')})`);
    assert.deepStrictEqual(twice, [], 'commands defined in more than one table');
    const orphans = [...Object.keys(extraFiles), ...Object.keys(extraAdmin), ...Object.keys(extraSubcommands)].filter((n) => !where.has(n) && !Object.hasOwn(builtins, n));
    assert.deepStrictEqual(orphans, [], 'extras for commands with no base entry');
  });

  it('does not point at the value of an option with "この" or "this" (it reads as the current one)', () => {
    const bad: string[] = [];
    everySpec((path, doc) => {
      for (const opt of doc.options ?? []) {
        if (opt.value && !(opt.value as ValueSpec).optional && /この|これ|\bthis\b/.test(opt.text.ja + ' ' + opt.text.en.replace(/\bthis (?:is|one)\b/g, ''))) bad.push(`${path} ${opt.names[0]}: ${opt.text.ja} / ${opt.text.en}`);
      }
    });
    assert.deepStrictEqual(bad, [], 'say "指定した…" / "the given …" for the value');
  });
});

describe('the specs of the dictionary', () => {
  it('give each option name once at each level', () => {
    const twice: string[] = [];
    everySpec((path, spec) => {
      const names = (spec.options ?? []).flatMap((o) => o.names);
      twice.push(...names.filter((n, i) => names.indexOf(n) !== i).map((n) => `${path} ${n}`));
    });
    assert.deepStrictEqual(twice, []);
  });

  it('give a value spec to every option that takes a value', () => {
    const bad: string[] = [];
    const check = (path: string, o: OptionSpec) => {
      for (const v of [o.value ?? []].flat()) {
        if (!v.name || (v.next && !v.optional) || (v.how === 'attached-only' && !v.optional)) bad.push(`${path} ${o.names[0]}`);
      }
      if (o.until && (o.value || !o.until.terminators.length)) bad.push(`${path} ${o.names[0]} (until)`);
    };
    everySpec((path, spec) => {
      for (const o of spec.options ?? []) check(path, o);
      for (const [letter, o] of Object.entries(spec.oldStyle?.letters ?? {})) check(`${path} (letter ${letter})`, o);
    });
    assert.deepStrictEqual(bad, []);
    // A tuple that gives the value a language or meanings, but no value, is a mistake in the dictionary.
    assert.throws(() => cmd('x', 'x', [['-x', 'x', 'x', 'lang:sed']]), /-x: a language or values, but no value/);
    assert.throws(() => cmd('x', 'x', [['-x', 'x', 'x', '', { a: tx('a', 'a') }]]), /-x: a language or values, but no value/);
  });

  it('have operand patterns that some words fit', () => {
    // For each alternative: the words its pattern takes (each item once, then each repeating item twice), after
    // the options its condition names. The alternative must be the one the interpreter chooses for one of them.
    const unreachable: string[] = [];
    everySpec((path, spec) => {
      (spec.operands ?? []).forEach((alt, k) => {
        const optionWords = (o: OptionSpec | undefined): string[] => (o ? [o.names[0], ...[o.value ?? []].flat().filter((v) => !v.optional).map(() => 'V')] : []);
        const find = (pred: (o: OptionSpec) => boolean) => (spec.options ?? []).find(pred);
        // (A condition on an option's value: the option with a value the condition matches.)
        const valued = alt.when && 'optionValue' in alt.when ? alt.when : undefined;
        const befores: string[][] = valued ? ['-i', 'A=1', 'w0rd'].filter((x) => valued.matches.test(x)).map((x) => [valued.optionValue[0], x]) : [];
        const before = !alt.when || 'not' in alt.when || 'operand' in alt.when || valued ? []
          : 'option' in alt.when ? optionWords(find((o) => o.names.includes((alt.when as { option: string[] }).option[0])) ?? { names: alt.when.option, text: tx('', '') })
          : optionWords(find((o) => o.selects === (alt.when as { mode: string }).mode));
        const item = (o: (typeof alt.pattern)[number]) => (o.assignment ? 'A=1' : o.option ?? (o.command ? 'true' : 'w0rd'));
        const once = alt.pattern.flatMap((o) => (o.repeat === '?' || o.repeat === '*' ? [] : [item(o)]));
        const each = alt.pattern.flatMap((o) => (o.repeat === '?' || o.repeat === '*' ? [item(o)] : [item(o)]));
        const twice = alt.pattern.flatMap((o) => (o.repeat === '*' || o.repeat === '+' ? [item(o), item(o)] : [item(o)]));
        // (A condition on an operand's value: that operand is a word the condition matches.)
        const shaped = (ws: string[]): string[] => {
          const c = alt.when && 'operand' in alt.when ? alt.when : undefined;
          return c ? ws.map((w, i) => (i === c.operand ? ['1', 'w0rd'].find((x) => c.matches.test(x))! : w)) : ws;
        };
        const fits = (valued ? befores : [before]).some((b) => [once, each, twice].some((ws) => interpret(spec, [...b, ...shaped(ws)].map((value) => ({ value })), { name: path }).alternative === k));
        if (!fits) unreachable.push(`${path} #${k}`);
      });
    });
    assert.deepStrictEqual(unreachable, []);
  });
});
