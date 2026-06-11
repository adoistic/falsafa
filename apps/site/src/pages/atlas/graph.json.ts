import type { APIRoute } from 'astro';
import {
  languages,
  people,
  places,
  sources,
  stats,
  transmissions,
  works,
} from '../../lib/atlas/data.ts';

export const GET: APIRoute = () => {
  const payload = {
    name: 'Naql',
    description: 'An atlas of how books crossed languages.',
    license: 'CC BY 4.0',
    stats: stats(),
    languages,
    places,
    people,
    works,
    transmissions,
    sources,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
};
