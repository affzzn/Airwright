/**
 * Login has no data fetch and its own centred layout — so it needs no skeleton.
 * A `null` fallback here also shields the login segment from the root
 * `loading.tsx`, so toggling sign-in / sign-up never flashes the app skeleton.
 */
export default function Loading() {
  return null;
}
