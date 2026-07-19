/** Implemented provider IDs. Additional IDs can be registered by extensions. */
export type AuthenticationKind = 'none' | 'basic' | 'bearer' | 'apiKey';

/** A credential source. Literal values require an explicit unsafe marker. */
export type AuthenticationValueSource =
  | { readonly kind: 'secret' }
  | { readonly kind: 'variable'; readonly name: string }
  | { readonly kind: 'literal'; readonly value: string; readonly unsafe: true };

interface AuthenticationProfileBase {
  readonly id: string;
  readonly label?: string;
  readonly providerId: string;
}

export interface NoneAuthenticationProfile extends AuthenticationProfileBase {
  readonly providerId: 'none';
}

export interface BasicAuthenticationProfile extends AuthenticationProfileBase {
  readonly providerId: 'basic';
  readonly username: AuthenticationValueSource;
  readonly password: AuthenticationValueSource;
}

export interface BearerAuthenticationProfile extends AuthenticationProfileBase {
  readonly providerId: 'bearer';
  readonly token: AuthenticationValueSource;
}

export interface ApiKeyAuthenticationProfile extends AuthenticationProfileBase {
  readonly providerId: 'apiKey';
  readonly name: string;
  readonly location: 'header' | 'query';
  readonly value: AuthenticationValueSource;
}

/** Open extension shape permits future OAuth2/JWT/cloud provider metadata. */
export type AuthenticationProfile =
  | NoneAuthenticationProfile
  | BasicAuthenticationProfile
  | BearerAuthenticationProfile
  | ApiKeyAuthenticationProfile
  | (AuthenticationProfileBase & Readonly<Record<string, unknown>>);

/** Legacy metadata name retained as an alias to the profile extension shape. */
export type Authentication = AuthenticationProfile;
