export const loader = () => {
  throw new Error('DB 접속 정보가 들어간 내부 에러');
};

export default function Boom() {
  return <main>안 보여야 한다</main>;
}
