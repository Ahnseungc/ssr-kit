import { type LoaderArgs, useLoaderData } from 'ssr-kit';

import { findGold } from '../../db.server';

export const loader = ({ params }: LoaderArgs<'/gold/:id'>) => ({ name: findGold(params.id).name });

export default function Gold() {
  return <h1>{useLoaderData<typeof loader>().name}</h1>;
}
