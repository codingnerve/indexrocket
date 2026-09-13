'use client';

import { ArrowRight, BadgeCheck, CreditCard, Lock, LogOut, Monitor, Plug, Radar, User } from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/app/components/ui/badge';
import { Button } from '@/app/components/ui/button';
import { Card, CardBody, CardHeader } from '@/app/components/ui/card';
import { DetailList, PageHeader } from '@/app/components/ui/misc';
import { formatNumber, humanize } from '@/app/lib/format';
import { useSession } from '@/app/lib/session';
import { ThemeSwitcher } from '@/app/lib/theme';

export default function SettingsPage() {
  const { user, signOut } = useSession();

  return (
    <>
      <PageHeader title="Settings" description="Your account, plan and preferences." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" icon={User} description="The details on your IndexRocket account." />
          <CardBody className="space-y-3">
            <DetailList
              items={[
                { label: 'Name', value: user.name },
                { label: 'Email', value: user.email },
                { label: 'Role', value: humanize(user.role) },
              ]}
            />
            <p className="text-xs text-muted">Profile details can’t be edited from the dashboard yet.</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Plan & credits" icon={CreditCard} />
          <CardBody>
            <DetailList
              items={[
                { label: 'Current plan', value: <Badge tone="primary">{humanize(user.plan)}</Badge> },
                {
                  label: 'Credits remaining',
                  value: <span className="font-medium tabular-nums">{formatNumber(user.credits)}</span>,
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Appearance" icon={Monitor} description="Choose how IndexRocket looks on this device." />
          <CardBody>
            <ThemeSwitcher showLabels />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Security" icon={Lock} />
          <CardBody className="space-y-4">
            <p className="text-[13px] leading-5 text-muted">
              You’re signed in with a secure, HttpOnly session cookie that scripts can’t read. Sessions end after 7 days
              without activity, and signing out ends the session on the server immediately.
            </p>
            <Button icon={LogOut} onClick={() => void signOut()}>
              Sign out
            </Button>
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Integrations" icon={Plug} />
          <ul className="divide-y divide-border">
            {[
              { href: '/google', icon: BadgeCheck, title: 'Google Search Console', text: 'Connection, properties and URL inspection.' },
              { href: '/indexnow', icon: Radar, title: 'IndexNow', text: 'Key status and notification results per project.' },
            ].map(({ href, icon: Icon, title, text }) => (
              <li key={href}>
                <Link href={href} className="group flex items-center gap-3 px-5 py-4 transition-colors hover:bg-card-hover">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-subtle text-muted">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted">{text}</p>
                  </div>
                  <ArrowRight className="size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
