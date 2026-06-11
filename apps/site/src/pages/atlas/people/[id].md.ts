import type { APIRoute } from 'astro';
import { people } from '../../../lib/atlas/data.ts';
import { personToMarkdown } from '../../../lib/atlas/markdown.ts';

export function getStaticPaths() {
  return people.map((person) => ({ params: { id: person.id }, props: { person } }));
}

export const GET: APIRoute = ({ props }) => {
  return new Response(personToMarkdown(props.person), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
};
