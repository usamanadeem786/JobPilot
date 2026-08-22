'use client';

import { Menu, X } from 'lucide-react';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { AppSidebar } from './app-sidebar';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/**
 * Sidebar + top bar chrome. The sidebar is a fixed rail from `lg` up and an
 * overlay drawer below it, so the same navigation works on a phone.
 */
export function AppShell({ children }: { children: React.ReactNode }): React.ReactElement {
  const [isNavOpen, setIsNavOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-0 h-screen">
          <AppSidebar />
        </div>
      </aside>

      {isNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/50"
            onClick={() => setIsNavOpen(false)}
          />
          <div className="relative h-full w-64 bg-sidebar shadow-xl">
            <AppSidebar />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-2"
              onClick={() => setIsNavOpen(false)}
              aria-label="Close navigation"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-4 backdrop-blur">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setIsNavOpen(true)}
            aria-label="Open navigation"
          >
            <Menu className="size-4" />
          </Button>
          <div className="flex-1" />
          <ThemeToggle />
          <UserMenu />
        </header>

        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
