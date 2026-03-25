import type { DbBackend } from "./backend.js";
import { nowIso } from "./dates.js";
import { KaryaError } from "./errors.js";
import { createId } from "./id.js";
import { UserSchema, type User, type UserType } from "./schema.js";

export class UserStore {
  private initializePromise: Promise<void> | null = null;

  constructor(private readonly backend: DbBackend) {}

  async ensureInitialized(): Promise<void> {
    if (!this.initializePromise) {
      this.initializePromise = this.backend.initialize();
    }

    await this.initializePromise;
  }

  async addUser(input: { name: string; alias: string; type?: UserType }): Promise<User> {
    await this.ensureInitialized();
    const existing = await this.backend.users.getUserByAlias(input.alias);
    if (existing) {
      throw new KaryaError(`User alias already exists: ${input.alias}`, "VALIDATION");
    }

    const user = UserSchema.parse({
      id: createId(),
      name: input.name,
      alias: input.alias,
      type: input.type ?? "human",
      createdAt: nowIso(),
      deactivatedAt: null,
    });

    await this.backend.users.putUser(user);
    return user;
  }

  async listUsers(includeDeactivated = false): Promise<User[]> {
    await this.ensureInitialized();
    const users = await this.backend.users.getAllUsers();
    return users.filter((user) => includeDeactivated || user.deactivatedAt === null);
  }

  async editUser(idOrAlias: string, updates: { name?: string; alias?: string; type?: UserType }): Promise<User> {
    const existing = await this.resolveAnyUser(idOrAlias);
    if (updates.alias && updates.alias !== existing.alias) {
      const aliasMatch = await this.backend.users.getUserByAlias(updates.alias);
      if (aliasMatch && aliasMatch.id !== existing.id) {
        throw new KaryaError(`User alias already exists: ${updates.alias}`, "VALIDATION");
      }
    }

    const next = UserSchema.parse({
      ...existing,
      name: updates.name ?? existing.name,
      alias: updates.alias ?? existing.alias,
      type: updates.type ?? existing.type,
    });
    await this.backend.users.putUser(next);
    return next;
  }

  async deactivateUser(idOrAlias: string): Promise<User> {
    const existing = await this.resolveAnyUser(idOrAlias);
    const next = UserSchema.parse({
      ...existing,
      deactivatedAt: existing.deactivatedAt ?? nowIso(),
    });
    await this.backend.users.putUser(next);
    return next;
  }

  async resolveUser(aliasOrId: string): Promise<User> {
    const user = await this.resolveAnyUser(aliasOrId);
    if (user.deactivatedAt) {
      throw new KaryaError(`User is deactivated: ${aliasOrId}`, "INVALID_STATE");
    }

    return user;
  }

  async requireActiveUser(alias: string): Promise<User> {
    const user = await this.backend.users.getUserByAlias(alias);
    if (!user) {
      throw new KaryaError(`User not found: ${alias}`, "NOT_FOUND");
    }
    if (user.deactivatedAt) {
      throw new KaryaError(`User is deactivated: ${alias}`, "INVALID_STATE");
    }
    return user;
  }

  private async resolveAnyUser(aliasOrId: string): Promise<User> {
    await this.ensureInitialized();

    const byAlias = await this.backend.users.getUserByAlias(aliasOrId);
    if (byAlias) {
      return byAlias;
    }

    const byId = await this.backend.users.getUser(aliasOrId);
    if (byId) {
      return byId;
    }

    throw new KaryaError(`User not found: ${aliasOrId}`, "NOT_FOUND");
  }
}
