/**
 * The Python release whose rules the host follows (docs/design/python-regex.md, section 8): the tests run that release
 * (`$BASH_EXPLAINER_PYTHON`), and CI installs it. A newer release changes this constant and the CI's `python-version`. A module of
 * its own, so that what links to Python's documentation (src/references.ts, which the views read) imports no reader of Python.
 */
export const PYTHON_REFERENCE = '3.15';
