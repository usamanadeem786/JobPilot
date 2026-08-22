'use client';

import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { LogOut, User } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/features/auth/auth-provider';
import { initialsOf } from '@/lib/utils';

export function UserMenu(): React.ReactElement | null {
  const { user, logout } = useAuth();
  const [isSigningOut, setIsSigningOut] = React.useState(false);

  if (!user) return null;

  const handleLogout = async (): Promise<void> => {
    setIsSigningOut(true);
    try {
      await logout();
    } catch {
      toast.error('Could not sign out cleanly, but this device has been signed out.');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex items-center gap-2 rounded-full border border-border p-1 pr-3 text-sm hover:bg-accent"
        aria-label="Account menu"
      >
        <span className="grid size-7 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {initialsOf(user.fullName ?? user.email)}
        </span>
        <span className="hidden max-w-40 truncate sm:inline">{user.fullName ?? user.email}</span>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <div className="px-3 py-2">
            <p className="truncate text-sm font-medium">{user.fullName ?? 'Your account'}</p>
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent"
            asChild
          >
            <a href="/settings">
              <User className="size-4" aria-hidden />
              Profile &amp; settings
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm text-destructive outline-none data-[highlighted]:bg-accent"
            disabled={isSigningOut}
            onSelect={(event) => {
              event.preventDefault();
              void handleLogout();
            }}
          >
            <LogOut className="size-4" aria-hidden />
            {isSigningOut ? 'Signing out…' : 'Sign out'}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
