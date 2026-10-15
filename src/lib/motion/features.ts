// The animation features, in a file of their own so `LazyMotion` can load them with a dynamic
// import (`MotionProvider features="lazy"`): the library's weight is paid after the first paint.
export { domAnimation, domMax } from "motion/react";
