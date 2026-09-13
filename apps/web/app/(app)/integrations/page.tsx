'use client';

import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BadgeCheck, Radar } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/app/components/ui/badge';
import { LinkButton } from '@/app/components/ui/button';
import { Card } from '@/app/components/ui/card';
import { ErrorState, Skeleton } from '@/app/components/ui/feedback';
import { PageHeader } from '@/app/components/ui/misc';
import { describeError } from '@/app/lib/api';
import { loadGoogleAvailability, loadProjects, type GoogleAvailability } from '@/app/lib/data';
import { formatNumber } from '@/app/lib/format';
import { useResource } from '@/app/lib/hooks';
import type { Project } from '@/app/lib/types';

async function loadIntegrations(): Promise<{ google: GoogleAvailability; projects: Project[] }> {
  const [google, projects] = await Promise.all([loadGoogleAvailability(), loadProjects()]);

  return { google, projects };
}

function IntegrationCard({
  icon: Icon,
  title,
  description,
  status,
  href,
  cta,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  status: ReactNode;
  href: string;
  cta: string;
}) {
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        {status}
      </div>
      <h2 className="mt-4 text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 flex-1 text-[13px] leading-5 text-muted">{description}</p>
      <LinkButton href={href} className="mt-5 self-start" iconRight={ArrowRight}>
        {cta}
      </LinkButton>
    </Card>
  );
}

export default function IntegrationsPage() {
  const integrations = useResource('integrations', loadIntegrations);
  const data = integrations.data;

  const googleStatus =
    data === undefined ? (
      <Skeleton className="h-5 w-24" />
    ) : data.google.state === 'not-configured' ? (
      <Badge tone="neutral">Not available</Badge>
    ) : data.google.state === 'unavailable' ? (
      <Badge tone="warning">Status unknown</Badge>
    ) : data.google.connection.connected ? (
      <Badge tone="success" dot>
        Connected
      </Badge>
    ) : (
      <Badge tone="neutral">Not connected</Badge>
    );

  const configured = data?.projects.filter((project) => project.hasIndexNowKey).length ?? 0;
  const total = data?.projects.length ?? 0;

  return (
    <>
      <PageHeader title="Integrations" description="Services IndexRocket works with on your behalf." />
      {integrations.error !== null && data === undefined ? (
        <Card>
          <ErrorState message={describeError(integrations.error)} onRetry={integrations.reload} />
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <IntegrationCard
            icon={BadgeCheck}
            title="Google Search Console"
            description="Read-only access to your properties and Google’s URL Inspection API — the only source that can say whether a page is indexed."
            status={googleStatus}
            href="/google"
            cta="Manage Search Console"
          />
          <IntegrationCard
            icon={Radar}
            title="IndexNow"
            description="Notify participating search engines when pages are added or updated. Keys are configured per project."
            status={
              data === undefined ? (
                <Skeleton className="h-5 w-24" />
              ) : (
                <Badge tone={configured > 0 ? 'success' : 'neutral'} dot={configured > 0}>
                  {formatNumber(configured)} of {formatNumber(total)} projects
                </Badge>
              )
            }
            href="/indexnow"
            cta="View IndexNow"
          />
        </div>
      )}
    </>
  );
}
