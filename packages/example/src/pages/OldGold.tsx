import { type LoaderArgs, redirect } from 'ssr-kit';

export const loader = ({ params }: LoaderArgs<'/old-gold/:id'>) =>
  redirect(`/gold/${params.id}`, 301);

export default function OldGold() {
  return null;
}
