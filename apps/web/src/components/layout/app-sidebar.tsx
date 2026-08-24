'use client';

import {
  Briefcase,
  Clock,
  FileText,
  LayoutDashboard,
  Search,
  Send,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import * as React from 'react';
import { cn } from '@/lib/utils';

interface NavItem {
  /** `Route` is Next's typed-routes union: a typo here fails the build. */
  readonly href: Route;
  readonly label: string;
  readonly icon: LucideIcon;
  /** Phase that delivers the screen; shown as a "soon" badge until then. */
  readonly available: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, available: true },
  { href: '/jobs', label: 'Jobs', icon: Briefcase, available: true },
  { href: '/latest', label: 'Latest', icon: Clock, available: true },
  { href: '/searches', label: 'Searches', icon: Search, available: true },
  { href: '/cvs', label: 'CVs', icon: FileText, available: true },
  { href: '/applications', label: 'Applications', icon: Send, available: true },
  { href: '/contacts', label: 'Contacts', icon: Users, available: true },
  { href: '/settings', label: 'Settings', icon: Settings, available: true },
];

export function AppSidebar({ className }: { className?: string }): React.ReactElement {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className={cn(
        'flex h-full w-full flex-col gap-1 border-r border-sidebar-border bg-sidebar p-3',
        className,
      )}
    >
      <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-2 py-1">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          JP
        </span>
        <span className="text-base font-semibold tracking-tight">JobPilot</span>
      </Link>

      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1">{item.label}</span>
            {!item.available && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Soon
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
