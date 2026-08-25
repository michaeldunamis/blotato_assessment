import { UnsupportedPlatformError } from "../errors.js";
import type { Platform } from "../types/platform.js";
import type { PlatformAdapter } from "./platformAdapter.js";
import { TwitterAdapter } from "./twitter/twitterAdapter.js";
import { InstagramAdapter } from "./instagram/instagramAdapter.js";

/** Maps platform to adapter. New platform = implement PlatformAdapter + register it here. */
export interface IAdapterRegistry {
  get(platform: Platform): PlatformAdapter;
}

export class AdapterRegistry implements IAdapterRegistry {
  private readonly adapters = new Map<Platform, PlatformAdapter>();

  constructor(adapters: PlatformAdapter[] = [new TwitterAdapter(), new InstagramAdapter()]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.platform, adapter);
    }
  }

  get(platform: Platform): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) {
      throw new UnsupportedPlatformError(platform);
    }
    return adapter;
  }
}
