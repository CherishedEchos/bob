/**
 * Persistence boundary.
 *
 * The UI never talks to storage directly — it calls the store's actions,
 * which validate input, apply the change, write an audit entry, then hand the
 * new snapshot to a Repository.
 *
 * Today: LocalDemoRepository (browser localStorage, fictional data only).
 * Next:  SupabaseRepository (see ./supabase-repository.ts) — per-entity writes
 *        through authenticated server actions with Row Level Security.
 */
import type { AppData } from "@/lib/types";
import { createSeedData, DEMO_DATA_VERSION } from "@/lib/demo/seed";

export interface Repository {
  readonly kind: "local-demo" | "supabase";
  load(): Promise<AppData>;
  persist(data: AppData): Promise<void>;
  reset(): Promise<AppData>;
}

const STORAGE_KEY = "ninety3.demo.data";

export class LocalDemoRepository implements Repository {
  readonly kind = "local-demo" as const;

  async load(): Promise<AppData> {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as AppData;
        if (parsed?.version === DEMO_DATA_VERSION && Array.isArray(parsed.jobs)) return parsed;
      }
    } catch {
      /* storage unavailable or corrupt — fall back to fresh seed */
    }
    const seed = createSeedData();
    await this.persist(seed);
    return seed;
  }

  async persist(data: AppData): Promise<void> {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* private mode / quota — demo continues in memory */
    }
  }

  async reset(): Promise<AppData> {
    const seed = createSeedData();
    await this.persist(seed);
    return seed;
  }
}

export function createRepository(): Repository {
  // When Supabase is configured this will return a SupabaseRepository.
  // Kept as a single switch so nothing else in the app has to change.
  return new LocalDemoRepository();
}
