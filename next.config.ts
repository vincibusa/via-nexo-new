import type { NextConfig } from "next";

// Origini consentite — lette al runtime del server (non build time)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  async headers() {
    // Costruiamo una regola per ogni origine consentita, perché
    // Access-Control-Allow-Origin accetta un solo valore alla volta.
    // next.config headers vengono applicati da Vercel DOPO la serverless function,
    // quindi sovrascrivono (o si aggiungono a) quanto già impostato dal route handler.
    const corsHeaders = [
      { key: 'Access-Control-Allow-Methods', value: 'GET,POST,PUT,DELETE,PATCH,OPTIONS' },
      {
        key: 'Access-Control-Allow-Headers',
        value: 'Content-Type,Authorization,X-Requested-With,Accept,Origin,x-app-version,accept-language',
      },
      { key: 'Access-Control-Allow-Credentials', value: 'true' },
      { key: 'Access-Control-Max-Age', value: '86400' },
    ]

    // Una voce per ogni origine: Vercel applica la prima che matcha,
    // ma noi aggiungiamo anche la logica dinamica nel middleware.
    // Usiamo l'approccio "has" per far sì che la regola si attivi solo
    // se l'header Origin combacia con quell'origine specifica.
    const originRules = ALLOWED_ORIGINS.map((origin) => ({
      source: '/api/:path*',
      has: [{ type: 'header' as const, key: 'origin', value: origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }],
      headers: [
        ...corsHeaders,
        { key: 'Access-Control-Allow-Origin', value: origin },
      ],
    }))

    // Fallback senza has: aggiunge solo i metodi/header senza Allow-Origin
    // (per client same-origin o senza header Origin)
    const fallbackRule = {
      source: '/api/:path*',
      headers: corsHeaders,
    }

    return [...originRules, fallbackRule]
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'rjtqgxppsopennukillx.supabase.co',
        port: '',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
