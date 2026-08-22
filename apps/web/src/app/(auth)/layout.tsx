import * as React from 'react';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <div className="flex w-full flex-col items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="grid size-9 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
            JP
          </span>
          <span className="text-lg font-semibold tracking-tight">JobPilot</span>
        </div>
        {children}
      </div>
    </div>
  );
}
