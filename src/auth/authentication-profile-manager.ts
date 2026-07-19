import type { Disposable } from '../configuration';
import type { AuthenticationProfile } from '../models';
import {
  validateAuthenticationProfiles,
  type AuthenticationProfileValidation,
} from './authentication-profile-validation';

export interface AuthenticationProfileRepository {
  getProfiles(): readonly AuthenticationProfile[];
  onDidChange(listener: () => void): Disposable;
}

/**
 * A validated snapshot: valid immutable profiles, structured issues, and the
 * explicit session default. A single malformed or duplicate entry never makes
 * this throw, so the picker and every valid/none execution remain functional.
 */
export interface AuthenticationProfileSnapshot
extends AuthenticationProfileValidation {
  readonly defaultProfileId?: string;
}

/**
 * Owns the explicit session default. An @auth directive always takes
 * precedence; the manager never edits source files.
 */
export class AuthenticationProfileManager {
  private selectedProfileId: string | undefined;
  private readonly listeners = new Set<() => void>();

  public constructor(private readonly repository: AuthenticationProfileRepository) {}

  public capture(): AuthenticationProfileSnapshot {
    const validation = validateAuthenticationProfiles(this.repository.getProfiles());
    const selected = this.selectedProfileId;
    return Object.freeze({
      profiles: validation.profiles,
      issues: validation.issues,
      ...(selected === undefined ? {} : { defaultProfileId: selected }),
    });
  }

  public list(): readonly AuthenticationProfile[] {
    return this.capture().profiles;
  }

  public get defaultProfileId(): string | undefined {
    return this.selectedProfileId;
  }

  public selectDefault(profileId: string | undefined): void {
    if (
      profileId !== undefined &&
      !this.capture().profiles.some((profile) => profile.id === profileId)
    ) {
      throw new Error(`Authentication profile "${profileId}" is not configured.`);
    }
    if (this.selectedProfileId !== profileId) {
      this.selectedProfileId = profileId;
      this.listeners.forEach((listener) => listener());
    }
  }

  public onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    const repositoryRegistration = this.repository.onDidChange(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
        repositoryRegistration.dispose();
      },
    };
  }
}
