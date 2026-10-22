#!/usr/bin/env bats
# A bats-core test file: each @test becomes a function that bats runs with set -e.

setup() {
  load test_helper
  bats_require_minimum_version 1.5.0
}

@test "addition works" {
  run expr 1 + 2
  [ "$status" -eq 0 ]
  [ "$output" = 3 ]
}

@test "a missing file is an error" {
  run ! cat /no/such/file
  run -1 cat /no/such/file
  run --separate-stderr cat /no/such/file
  [ "${stderr_lines[0]}" != "" ]
  ! grep -q x /dev/null
  run printf 'a\nb\n' | grep a
  run bats_pipe printf 'a\nb\n' \| grep a
  [ "${lines[0]}" = a ]
}

@test 'empty' { }

@test "not ready" {
  skip "not yet"
  ! false
}
