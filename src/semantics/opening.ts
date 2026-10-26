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
 * What a shell is started with: the options of `set` and `shopt`, and the variables given to it, each with its value
 * (null: unset; undefined: not known).
 */
export interface Opening {
  readonly set?: ReadonlyMap<string, 'on' | 'off'>;
  readonly shopt?: ReadonlyMap<string, 'on' | 'off'>;
  readonly variables?: Iterable<readonly [string, string | null | undefined]>;
}

/** Why a shell started with `o` trusts nothing, by the rows of the allow-list, as if they were set on its first line. */
export function openingBlinds(o: Opening): string | undefined {
  for (const [table, options] of [[SET_OPTIONS, o.set], [SHOPT_OPTIONS, o.shopt]] as const) {
    for (const [name, state] of options ?? []) {
      const row = optionRow(table, name, state === 'on');
      if (row.effect.kind === 'all') return row.effect.why;
    }
  }
  for (const [name, value] of o.variables ?? []) {
    if (localeVariable(name)) {
      if (value !== null && (value === undefined || !cLocale(value))) return `\`${name}\` may be set to a locale other than C`;
      continue;
    }
    const row = writeEffect(name);
    if (row.effect.kind === 'all') return row.effect.why;
  }
  return undefined;
}

/**
 * What another shell is started with (`bash -c`, `Walker.childStart`): the options of its invocation (`-k`, `-o name`,
 * `-O name`), and the variables it starts with. POSIX mode, which its walk follows from the start (`posix`: it starts
 * in it), is left out, and so is the POSIXLY_CORRECT it sets.
 */
export function childOpening(invocation: readonly { readonly flag: string; readonly value?: string }[], variables: Iterable<readonly [string, { readonly set: string; readonly value?: string }]>, posix: boolean): Opening {
  const set = new Map<string, 'on' | 'off'>();
  const shopt = new Map<string, 'on' | 'off'>();
  for (const { flag, value } of invocation) {
    const state = flag[0] === '-' ? 'on' : 'off';
    if (/^[-+]o$/.test(flag) && value && value !== 'posix') set.set(value, state);
    else if (/^[-+]O$/.test(flag) && value) shopt.set(value, state);
    else if (/^[-+][a-zA-Z]$/.test(flag) && SET_LETTERS[flag[1]]) set.set(SET_LETTERS[flag[1]], state);
  }
  const vars: [string, string | null | undefined][] = [];
  for (const [name, v] of variables) if (!(posix && name === 'POSIXLY_CORRECT')) vars.push([name, v.set === 'off' ? null : v.set === 'on' ? v.value : undefined]);
  return { set, shopt, variables: vars };
}
