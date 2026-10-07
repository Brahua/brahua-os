// The animation features the swipe needs (drag), in a file of their own so `LazyMotion` loads them
// with a dynamic import: the library's weight is paid only on screens whose rows can be swiped.
export { domMax } from "motion/react";
