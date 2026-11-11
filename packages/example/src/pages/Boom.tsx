export const loader = () => {
  throw new Error('Internal error with DB credentials');
};

export default function Boom() {
  return <main>Should not render</main>;
}
