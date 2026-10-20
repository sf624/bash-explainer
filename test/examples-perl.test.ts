import * as assert from 'assert';
import { run } from './support/run';
import { perlExample, perlOptions, runPerl } from '../src/examples/perlrun';

function realPerl(words: string[], input: string[]): string[] {
  const out = run('perl', words.map((w) => (/^-[a-zA-Z]*i/.test(w) ? w.replace('i', '') || '-p' : w)), { input: input.length ? input.join('\n') + '\n' : '' }).stdout.toString();
  return out === '' ? [] : out.replace(/\n$/, '').split('\n');
}

const cases: string[][] = [
  ['-pe', 's/foo(\\d+)/bar$1/g'], ['-ne', 'print if /^ERROR/'], ['-lane', 'print $F[1] if $F[2] > 100'], ['-F:', '-lane', 'print $F[0]'],
  ['-nle', '$sum += $_; END { print $sum }'], ['-lne', '$c{$_}++; END { print "$_ $c{$_}" for sort keys %c }'], ['-pe', 'tr/a-z/A-Z/'],
  ['-lne', 'print length'], ['-pe', '$_ = uc'], ['-lne', 'print "$.: $_"'], ['-ne', 'print unless /^\\s*#/'], ['-lane', 'print join ",", @F'],
  ['-le', 'print for 1..3'], ['-pe', 's/\\s+$//'], ['-lne', 'next if /^$/; print scalar reverse $_'], ['-lane', '$t += $F[1]; END { printf "%.2f\\n", $t / $. }'],
  ['-pe', 's/(\\w+)/\\u$1/g'], ['-lne', 'my @w = split /,/; print $w[1]'], ['-pi', '-e', 's/a/b/'], ['-lne', 'print "$1-$2" if /(\\w+) (\\w+)/'],
  ['-lne', 'print uc($_) . "!"'], ['-lane', 'print $F[-1]'], ['-lne', '$n++ if /e/; END { print $n }'], ['-pe', 's/^/> /'],
  ['-lne', 'print if length > 8'], ['-le', 'print join "-", map { $_ * 2 } 1..3'],
  // Syntax the ones above do not reach.
  ['-le', 'print for qw(a b c)'], ['-lne', 'print $_ > 5 ? "big" : "small"'], ['-lne', 'print if $_ !~ /x/'], ['-lane', 'print "$F[1] $F[-1]"'],
  ['-lne', 'if (/a/) { print "A" } elsif (/b/) { print "B" } else { print "-" }'], ['-lne', 'unless (/a/) { print }'],
  ['-lne', 'my $n = $_; $n++; print $n * 2'], ['-lne', 'print if $_ eq "x" || $_ == 3'], ['-lne', 'print join "|", split ",", $_'],
  ['-lne', 'my @m = /(\\w)/g; print scalar @m'], ['-lane', 'my @a = @F; print "@a"'],
  ['-lane', 'print join ",", sort { $a <=> $b } @F'], ['-pe', 's/(\\d+)/$1*2/e'], ['-pe', 'tr/abc/x/'], ['-le', 'print 2**10'],
  ['-le', 'print join ",", 1 < 2, 2 >= 2, 1 <=> 2, "a" lt "b", "b" gt "a", "a" le "a", "b" ge "a", "a" cmp "b"'],
  ['-lne', 'print ucfirst($_), lcfirst("AB"), abs(-3), int(3.7), sqrt(16), chr(65), ord("a"), substr($_, 1, 2), substr($_, -2), index($_, "b")'],
  ['-ne', 'chomp; print "[$_]", defined($_) ? 1 : 0, "\\n"'], ['-lne', '$h{$_} = 1; delete $h{a}; print exists $h{$_} ? "y" : "n"'],
  ['-lne', 'push @a, $_; END { print scalar @a }'], ['-lne', '$h{$_}++; END { print scalar(keys %h), scalar(%h) }'], ['-lne', 'print scalar(split /,/, $_)'],
  ['-ne', 'print; /b/ and last'], ['-ne', 'next if /a/; last if /c/; print'], ['-le', 'for (1..5) { last if $_ > 2; print }'],
];

describe('perl examples agree with perl', () => {
  for (const words of cases) {
    it(words.join(' '), function () {
      const parsed = perlOptions(words);
      const ex = parsed && perlExample(parsed.code, parsed.opts);
      if (words.join(' ').includes('map {')) {
        assert.strictEqual(ex, undefined, 'map is not supported');
        return;
      }
      assert.ok(ex, 'has an example');
      const out = ex.output[ex.output.length - 1] === '…' ? ex.output.slice(0, -1) : ex.output;
      assert.deepStrictEqual(out, realPerl(words, ex.input).slice(0, out.length), `input ${JSON.stringify(ex.input)}`);
    });
  }
  it('declines what it cannot run', () => {
    assert.strictEqual(runPerl('print while <>', { loop: 'n' }, ['a']), undefined);
    assert.strictEqual(runPerl('print if 2..3', { loop: 'n' }, ['a', 'b', 'c']), undefined);
    assert.strictEqual(perlOptions(['script.pl']), undefined);
  });
});

describe('the perl runner agrees with perl on the less common parts', () => {
  const input = ['apple 3 x,y', 'banana 10 z', '', 'Cherry -2.5 a,b,,'];
  const cases: string[][] = [
    ['-pe', 's{a\\}}{x}; s/\\//|/'], ['-pe', 's(a(p)?)(X)'], ['-lne', 'print # comment'], ['-le', "print 'it\\'s \\\\'"], ['-pe', 'y/a-z/A-Z/'],
    ['-pe', 's{a} {b}'], ['-le', 'print q(a b), qq{x}'], ['-lne', 'print "y" if /a/ and not /b/ or /z/'],     ['-lne', '$_ =~ tr/a/b/; print'], ['-lne', 'print !/a/, "|", -length'], ['-lne', '++$n; print $n'], ['-lne', 'print if /A/i; print "m" if /^b/m; print "s" if /a.p/s'],
    ['-le', 'my @a = (); print scalar @a'], ['-le', 'print 0.1 + 0.2, 1e21, 1/3'], ['-lne', 'print $& if /a./'], ['-lne', 'print "\\U$_\\E!", "\\Lab\\uc", "\\lAB"'],
    ['-lne', 'print "${_}x"'], ['-le', 'my @a = (1, 2, 3); my $i = 1; $a[1] = 5; print "@a $a[0] $a[-1] $a[$i]"'],     ['-le', 'print reverse 1..3'], ['-le', 'print join "|", split " ", "  a b"'], ['-lne', 'print join "|", split /,/, $_'], ['-le', 'print join ",", sort { $b <=> $a } 3, 10, 2'],
    ['-le', 'print join ",", sort { $a cmp $b } qw(b a c)'], ['-lne', 'my $c = tr/a//; print $c'], ['-pe', 'tr/a-c//d'], ['-pe', 'tr/a-z//s'], ['-pe', 'tr/a-z/A-C/'],
    ['-lne', '$x ||= $_; $y &&= 1; print "$x $y"'], ['-lne', 'print scalar(@F = split)'],     ['-le', 'print 7 % 3, 2 ** 3, -7 / 2, "3" + "4", "a" . 1'], ['-lne', 'print unless length'],     ['-le', 'my @a = (3, 1); push @a, 2; print scalar(@a), " ", "@a"'], ['-le', 'print "\\Uab\\lc", " ", "\\u\\LHELLO", " ", "\\L\\uHELLO"'], ['-lne', 'print $1 if /(\\d+)/'], ['-le', 'print "a" x 3'], ['-le', 'print ucfirst lc "HELLO"'],
    ['-le', 'my $x = 0; $x--; --$x; print $x'],
    ['-lne', 'print "y" if $_ =~ qr/a/'], ['-lne', 'print;;'], ['-le', 'BEGIN { print 0 } print 1'], 
    ['-lne', 'print if /a/ && /p/'], ['-le', 'print +1'], ['-le', 'my %h; $h{a} = 1; my $k = "a"; my @a = (5, 6); my $i = 1; print "$h{$k} $h{a} $a[$i] $a[-1] \\q"'],
    ['-le', 'my @a = (1, 2); $a[-1] = 9; print "@a"'], ['-le', 'my %h; $h{a} = 1; print join ",", %h; print values %h'], ['-lne', 'my @m = ($_ =~ /(\\w)/g); print scalar @m'],
    ['-lne', 'my @m = /(\\w+) (\\d+)/; print "@m"'], ['-le', 'print join ",", sort { $b cmp $a } qw(b a c)'], ['-le', 'my @a = (1, 2); my $n = @a; print $n'],
    ['-lne', 'my $c = s/a/b/g; print $c'], ['-pe', 'tr/a-c/A/'], ['-pe', 'tr/a/b/s'], ['-le', 'my $u; my $v; $u //= 3; $v ||= 4; my $w = 0; $w //= 5; print $u, $v, $w'],
    ['-le', 'print 5 - 2, 1 != 2, 1 <= 2, 2 <= 1, "a" ne "b", "a" eq "a", "b" lt "a", "a" gt "b", "b" le "a", "a" ge "b", 2 <=> 2, 1 != 1'],
    ['-le', 'print sprintf("%s-%d", "a", 3), substr("hello", 1), index("abc", "z"), defined($nope) ? 1 : 0, int("x"), lc, uc'],
    ['-le', 'printf "%d|%s\\n", "abc", 1'],
    ['-le', 'if (1) { ; print 1 }'], ['-le', 'for my $x (1..2) { print $x } for $y (3..4) { print $y }'], ['-le', 'print join ",", 1, 2,'],
    ['-le', 'print lc()'], ['-lne', 'my @m = /a/; my @g = /\\w/g; print scalar(@m), scalar(@g)'],
    ['-le', 'print sort qw(b a a)'], ['-lne', 'print s/a/b/r'], ['-lne', 'print tr/a/b/r'], ['-le', 'my $v = 1; $v ||= 2; print $v, $nope // 7, 0 // 8'],
    ['-le', 'print 1 == 2, 2 >= 3, 3 > 4, 4 < 3, "a" eq "b", "a" lt "a", "a" le "0", "0" ge "a", 1 <=> 1, 2 <=> 1'],
    ['-le', 'print substr("hello", 1, 2), index("abc", "b"), lc("AB"), uc("ab")'], ['-le', 'my $s = "a"; print chomp($s)'], ['-le', 'my %h; $h{a} = 1; print exists $h{a} ? 1 : 0'],
    ['-le', 'printf "%d|%d\\n", "12", "x"'], ['-le', 'for (1..3) { next if $_ == 2; print }'],
    ['-le', 'my $y = 1; $y &&= 2; print $y'], ['-le', 'print "b" le "a", "a" ge "b", "a" gt "a", "b" lt "a", "a" cmp "a", "b" cmp "a", "a" ne "a", 1 <= 2'],
    ['-le', 'print defined(length) ? 1 : 0; print ord("")'], ['-lne', 'print scalar reverse'], ['-le', 'my %h; $h{a} = 1; print exists $h{b} ? 1 : 0'], ['-Esay 1'], ['-lne', 'print and next if /a/; print "-"'], ['-nE', 'say'],
  ];
  const more: string[][] = [
    ['-n', '-e', 'print'], ['-l', '-n', '-e', 'print'], ['-F,', '-lne', 'print $F[0]'], ['-F/,/', '-ane', 'print $F[-1]'],
    ['-wlne', 'print'],
  ];
  cases.push(...more);
  for (const words of cases) {
    it(words.join(' '), () => {
      const parsed = perlOptions(words)!;
      assert.ok(parsed, 'options');
      assert.deepStrictEqual(runPerl(parsed.code, parsed.opts, input), realPerl(words, input));
    });
  }
  it('reads the switches it knows', () => {
    for (const words of [['-n', undefined, '-e', 'print'], ['-', '-e', 'x'], ['-e'], ['-l0', '-e', 'print'], ['-M', '-e', 'print'], ['-ne'], ['-l', '--', '-e', 'print 1']]) {
      assert.strictEqual(perlOptions(words), undefined, JSON.stringify(words));
    }
    assert.strictEqual(runPerl('print', { loop: 'n', autosplit: true, fieldSep: '[' }, ['a']), undefined);
    assert.strictEqual(runPerl('next', {}, ['a']), undefined);
    assert.strictEqual(runPerl('last', {}, ['a']), undefined);
  });
  it('makes up input for the less common cases', () => {
    assert.strictEqual(perlExample('print ~1', { loop: 'n' }), undefined);
    assert.strictEqual(perlExample('print join "|", split /[é]/', { loop: 'n', chompL: true }), undefined);
    for (const [words, check] of [
      [['-F\\s+', '-lane', 'print $F[1]'], (ex: { input: string[] }) => ex.input[0].includes(' ')],
      [['-F::', '-lane', 'print $F[1]'], (ex: { input: string[] }) => ex.input[0].includes(':')],
      [['-lane', 'print $F[1] if $F[1] > 0'], (ex: { input: string[] }) => ex.input.some((l) => l.includes('-2'))],
      [['-pe', 's/^a/b/; s/a$/b/; s/^z$/y/'], (ex: { input: string[] }) => ex.input.length > 2],
      [['-pe', 's/abc //'], (ex: { input: string[] }) => ex.input.some((l) => l.includes('abc '))],
      [['-lne', 'print for 1..10'], (ex: { output: string[] }) => ex.output[ex.output.length - 1] === '…'],
    ] as [string[], (ex: { input: string[]; output: string[] }) => boolean][]) {
      const p = perlOptions(words)!;
      const ex = perlExample(p.code, p.opts)!;
      assert.ok(ex && check(ex), JSON.stringify([words, ex]));
    }
  });
  it('gives up on what it does not run', () => {
    for (const code of ['print ~1', 'print /a/x', 's/a/b/x', 'print STDERR 1', 'while (1) {}', 'print 1..100000', 'my @p = split /,/, $_, 2', 'tr/a/b/c', 'my ($a, $b) = (1, 2)',
      'print keys 1', '$_ =~ $x', 'print (', '}', 'BEGIN',
      '($x = $_) =~ s/a/b/', 'my %h = (a => 1)', '$s x= 2', 'print map { $_ } 1', 'print "@a[0]"', 'our $x = 1', '{ print 1 }', 'print "a@b.c"', 'print 1 y /2/', 'if (1 { print }', 'print 1/0', 'print 1 % 0', 'for (1..2) { print 1/0 }', 'print exists $x', 'delete $x', 'push $x, 1', 'print foo(1)',
      'for (1..400) { for (1..400) { $x++ } }', 'my @s = sort { $a <=> $b }']) {
      assert.strictEqual(runPerl(code, { loop: 'n' }, input), undefined, code);
    }
  });
});
