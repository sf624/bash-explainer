// What a shell starts with, read through the allow-list of the trust (src/semantics/allow.ts; docs/design/
// trust-allow-list.md, section 2): the options of the shebang (`#!/bin/bash -k`) or of another shell's invocation
// (`bash -O compat31 -c`), and the variables of bash given to it (`#!/usr/bin/env -S BASH_COMPAT=42 bash`,
// `BASH_COMPAT=31 bash -c`). Also the values of a locale that change nothing a value or a decision reads.
import { optionRow, SET_OPTIONS, SHOPT_OPTIONS } from './allow';
import { SET_LETTERS } from './effects';
import { cLocale, localeVariable, writeEffect } from './vars';
import type { WrittenValue } from './written';

/** Whether a write of a locale variable gives it C or empty (`cLocale`), or keeps the environment's (README, Limitations). */
export function localeWritten(value: WrittenValue): boolean {
  if (value === 'none' || value === 'kept') return true;
  return typeof value === 'object' && !!value.fixed && !value.arith && !value.appended && (value.each ?? [value.text]).every(cLocale);
}

/**
 * What a shell is started with: the options of `set` and `shopt`, the variables given to it, each with its value
 * (null: unset; undefined: not known), and `others`: what else it is started with that the table does not have (an
 * option such as `-r`, `-i`, `--debugger`, an option of `-o` or `-O` not known, an `env -S` line not understood).
 */
export interface Opening {
  readonly set?: ReadonlyMap<string, 'on' | 'off'>;
  readonly shopt?: ReadonlyMap<string, 'on' | 'off'>;
  readonly variables?: Iterable<readonly [string, string | null | undefined]>;
  readonly others?: readonly string[];
}

/** The options a shell may be started with that change nothing but what the tables say (`-c` takes the string). */
export const HARMLESS_START = new Set(['-c', '--norc', '--noprofile', '--noediting', '--posix', '--', '-']);

/** Why a shell started with `o` trusts nothing, by the rows of the allow-list, as if they were set on its first line. */
export function openingBlinds(o: Opening): string | undefined {
  if (o.others?.length) return `the shell is started with \`${o.others[0]}\`, which the allow-list does not have`;
  for (const [table, options] of [[SET_OPTIONS, o.set], [SHOPT_OPTIONS, o.shopt]] as const) {
    for (const [name, state] of options ?? []) {
      const row = optionRow(table, name, state === 'on');
      if (row.effect.kind === 'all') return row.effect.why;
    }
  }
  for (const [name, value] of o.variables ?? []) {
    if (value === null) continue;
    if (name === '*') return 'the shell is started with variables not known';
    // (At its start, bash turns on the options SHELLOPTS and BASHOPTS list, and POSIX mode for POSIX_PEDANTIC: given
    // as values, what the walk does not start with.)
    if (['SHELLOPTS', 'BASHOPTS', 'POSIX_PEDANTIC'].includes(name)) return `the shell is started with \`${name}\`, which turns on options at its start`;
    if (localeVariable(name)) {
      if (value === undefined || !cLocale(value)) return `\`${name}\` may be set to a locale other than C`;
      continue;
    }
    const row = writeEffect(name);
    if (row.effect.kind === 'all') return row.effect.why;
  }
  return undefined;
}

/**
 * What another shell is started with (`bash -c`, `childStart`): the options of its invocation (`-k`, `-o name`,
 * `-O name`), and the variables it starts with. POSIX mode, which its walk follows from the start (`posix`: it starts
 * in it), is left out, and so is the POSIXLY_CORRECT it sets.
 */
export function childOpening(invocation: readonly { readonly flag: string; readonly value?: string }[], variables: Iterable<readonly [string, { readonly set: string; readonly value?: string }]>, posix: boolean): Opening {
  const set = new Map<string, 'on' | 'off'>();
  const shopt = new Map<string, 'on' | 'off'>();
  const others: string[] = [];
  for (const { flag, value } of invocation) {
    const state = flag[0] === '-' ? 'on' : 'off';
    const named = /^[-+][oO]$/.test(flag);
    if (named && value === undefined) others.push(`${flag} …`);
    else if (named && flag[1] === 'O') shopt.set(value!, state);
    else if (named && value !== 'posix') set.set(value!, state);
    else if (/^[-+][a-zA-Z]$/.test(flag) && SET_LETTERS[flag[1]]) set.set(SET_LETTERS[flag[1]], state);
    else if (!named && !HARMLESS_START.has(flag)) others.push(flag);
  }
  const vars: [string, string | null | undefined][] = [];
  for (const [name, v] of variables) if (!(posix && name === 'POSIXLY_CORRECT')) vars.push([name, v.set === 'off' ? null : v.set === 'on' ? v.value : undefined]);
  return { set, shopt, variables: vars, others };
}
