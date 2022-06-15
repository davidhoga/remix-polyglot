import type { I18nHandle } from 'remix-polyglot';
import { usePolyglot } from 'remix-polyglot';
import { Link, Outlet, useLocation } from '@remix-run/react';

export const handle: I18nHandle = {
  i18n: 'common',
};

export default function Component() {
  const { locale, tx } = usePolyglot('common');
  const loc = useLocation();
  const langSwitch = {
    ...loc,
    pathname: [
      locale === 'en' ? '/es' : '/en',
      ...loc.pathname.split('/').slice(2),
    ].join('/'),
  };

  return (
    <>
      <h1>{tx('greeting', { name: <em>Human</em> })}</h1>
      <Link to={langSwitch}>{tx('switch-lang')}</Link>
      <br />
      <Outlet />
    </>
  );
}
