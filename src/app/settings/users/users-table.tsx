"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { USER_ROLES } from "@/lib/roles";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmButton } from "@/components/confirm-button";
import { deleteUser, setUserRole } from "./actions";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  signedUp: string;
};

const roleLabels: Record<string, string> = { user: "User", admin: "Admin" };

export function UsersTable({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(userId: string, action: () => Promise<{ error?: string }>, success: string) {
    setBusyId(userId);
    const result = await action();
    if (result.error) toast.error(result.error);
    else toast.success(success);
    setBusyId(null);
  }

  return (
    <div className="grid gap-3">
      {users.map((u) => {
        const isSelf = u.id === currentUserId;
        return (
          <div
            key={u.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{u.name}</span>
                {isSelf && <Badge variant="outline">You</Badge>}
              </div>
              <div className="truncate text-sm text-muted-foreground">
                {u.email} · joined {u.signedUp}
              </div>
            </div>
            {isSelf ? (
              // Admins can't change their own role or delete themselves (see
              // actions.ts), so don't render controls that can only fail.
              <div className="text-sm text-muted-foreground">{roleLabels[u.role] ?? u.role}</div>
            ) : (
              <>
                <Select
                  value={u.role}
                  disabled={busyId === u.id}
                  onValueChange={(role) =>
                    run(u.id, () => setUserRole({ userId: u.id, role }), "Role updated")
                  }
                >
                  <SelectTrigger className="w-32" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {roleLabels[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ConfirmButton
                  title={`Delete ${u.name}'s account?`}
                  description="They lose access immediately. Parts, BOMs and stock history they created stay."
                  confirmLabel="Delete user"
                  onConfirm={() => run(u.id, () => deleteUser({ userId: u.id }), "User deleted")}
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete user"
                    className="text-destructive hover:text-destructive"
                    disabled={busyId === u.id}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </ConfirmButton>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
