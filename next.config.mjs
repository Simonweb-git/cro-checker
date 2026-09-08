/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', 'playwright'],
  experimental: {
    // The core engine is written for direct ESM execution (tsx CLI, eval harness) and therefore uses
    // explicit `.js` import specifiers throughout (ADR-001: it must run outside Next.js too). This
    // makes Next's webpack resolve those specifiers back to the `.ts`/`.tsx` source instead of
    // requiring two different import styles across the codebase.
    extensionAlias: { '.js': ['.ts', '.tsx', '.js', '.jsx'] },
  },
};
export default nextConfig;
