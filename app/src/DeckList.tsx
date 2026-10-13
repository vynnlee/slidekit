import { useEffect, useState } from "react";
import { Presentation } from "lucide-react";
import { Card, CardGroup, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { SidebarGroup, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar";
import { Shell } from "./Shell";
import { go } from "./App";
import type { DeckEntry } from "@/lib/deck";

export function DeckList() {
  const [decks, setDecks] = useState<DeckEntry[] | null>(null);
  useEffect(() => { fetch("/api/decks").then((r) => r.json()).then(setDecks); }, []);

  const open = (d: DeckEntry) => go(`/edit/${encodeURIComponent(d.id)}`);
  const sub = (d: DeckEntry) => [d.date, d.author].filter(Boolean).join("  ");

  return (
    <Shell
      toolbar={<span className="px-2 text-subtitle font-medium">slidekit</span>}
      left={
        <SidebarGroup>
          <SidebarGroupLabel>덱</SidebarGroupLabel>
          <SidebarMenu>
            {decks?.map((d) => (
              <SidebarMenuItem key={d.id}>
                <SidebarMenuButton icon={Presentation} onClick={() => open(d)}>{d.title}</SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      }
    >
      <div className="p-4">
        {decks?.length === 0 && <p className="text-caption text-muted-foreground">decks 폴더에 덱이 없습니다</p>}
        <CardGroup columns={3} separated>
          {decks?.map((d) => (
            <Card key={d.id} onClick={() => open(d)} label={d.title}>
              <CardHeader>
                <CardTitle>{d.title}</CardTitle>
                <CardDescription>{sub(d) || d.folder}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </CardGroup>
      </div>
    </Shell>
  );
}
