import {
  type ActionArgs,
  Form,
  type HeadArgs,
  type LoaderArgs,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from 'ssr-kit';

import { addGuestbookEntry, listGuestbook } from '../data.server';

const MAX_MESSAGE_LENGTH = 40;

export const loader = async (_: LoaderArgs<'/guestbook'>) => ({ entries: await listGuestbook() });

export const action = async ({ request }: ActionArgs<'/guestbook'>) => {
  const form = await request.formData();
  const message = String(form.get('message') ?? '').trim();
  if (!message) return { error: '내용을 입력해 주세요' };
  if (message.length > MAX_MESSAGE_LENGTH) {
    return { error: `${MAX_MESSAGE_LENGTH}자 이하로 써 주세요` };
  }
  await addGuestbookEntry(message);
  // Post/Redirect/Get — 새로고침해도 다시 제출되지 않는다
  redirect('/guestbook');
};

export const head = (_: HeadArgs<typeof loader>) => ({ title: '방명록' });

export default function Guestbook() {
  const { entries } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  // redirect 로 돌아오면 location.key 가 바뀌어 입력이 비워진다. 검증 실패면 입력을 그대로 둔다
  const { key } = useLocation();
  const submitting = navigation.state === 'submitting';
  return (
    <main>
      <h1>방명록</h1>
      <Form method="post" key={key}>
        <label htmlFor="guestbook-message">한마디</label>
        <input id="guestbook-message" name="message" maxLength={MAX_MESSAGE_LENGTH * 2} />
        <button type="submit" disabled={submitting}>
          {submitting ? '남기는 중…' : '남기기'}
        </button>
      </Form>
      {actionData?.error ? (
        <p role="alert" data-testid="guestbook-error">
          {actionData.error}
        </p>
      ) : null}
      <ul data-testid="guestbook-entries">
        {entries.map((entry) => (
          <li key={entry.id}>{entry.message}</li>
        ))}
      </ul>
    </main>
  );
}
