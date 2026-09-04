// src/configs/setup-console.ts

if (process.env.NODE_ENV !== "development") {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {}; // optional: silence warnings too
}
