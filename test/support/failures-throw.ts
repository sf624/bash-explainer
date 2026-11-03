// Named in .mocharc.cjs: in the test suite an exception nothing was meant to throw fails the test, and is not contained by the
// boundaries the products have (src/failures.ts). A test of those boundaries turns them on for its own run.
import { failuresThrow } from '../../src/failures';

failuresThrow(true);
