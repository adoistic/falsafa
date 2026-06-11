import type { APIRoute } from 'astro';
import { places } from '../../../lib/atlas/data.ts';
import { placeToMarkdown } from '../../../lib/atlas/markdown.ts';

export function getStaticPaths() {
  return places.map((place) => ({ params: { id: place.id }, props: { place } }));
}

export const GET: APIRoute = ({ props }) => {
  return new Response(placeToMarkdown(props.place), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
