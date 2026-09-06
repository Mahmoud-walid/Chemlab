/**
 * Shared fixtures for the integration and end-to-end suites.
 *
 * #13 asks for these, and by the time they were written the same builders had
 * been hand-rolled in a dozen files. The cost was not typing: it was that
 * each copy had to know schema details unrelated to what it was testing, and
 * several of them got one wrong — a comment without its threading columns, a
 * section body of the wrong shape, a translation hash computed instead of
 * read back. Each cost a failure that looked like a bug in the product.
 *
 * See `tests/README.md` for when to reach for one.
 */
export * from "./accounts";
export * from "./content";
export * from "./ids";
export * from "./social";
export * from "./translations";
