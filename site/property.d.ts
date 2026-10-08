// Types for property.js, so the backend's tests can import it under strict mode.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OwnerSource {
  county: string;
  site: string;
  cities: string[];
  name: string;
  layer: string;
  address: string;
  owner: string;
  mail: string;
  read: (a: Record<string, any>) => Record<string, any>;
}

export type Geometry = { type: string; coordinates: any };

export const PROPERTY_TOOLS: [string, string][];
export const OWNER_SOURCES: OwnerSource[];
export const DRIVE_MINUTES: number[];
export const FALLBACK_MPH: number;
export const DEAL_LOAN: { down: number; closing: number; years: number; spread: number };
export const DEAL_TYPE_LABELS: Record<string, string>;
export function readPropertyHash(hash: string): { open: boolean; tool: string; city: string; q: string; lat: number | null; lng: number | null };
export function writePropertyHash(state: { tool?: string; city?: string; q?: string; lat?: number | null; lng?: number | null }): string;
export function parseAddress(text: string): { number: string; street: string; dir?: string } | null;
export function addressPlace(text: string): string;
export function rankAddresses<T extends { address?: string }>(parcels: T[], address: string, city?: string): T[];
export function addressWhere(source: OwnerSource, address: string): string | null;
export function ownerWhere(source: OwnerSource, by: { owner?: string; mailLine?: string }): string | null;
export function ownerLikeWhere(source: OwnerSource, name: string, loose?: boolean): string | null;
export function sameStreet(parcel: { address?: string }, address: string): boolean;
export function ownerWords(name: string): string[];
export function rankOwners<T extends { owner?: string }>(parcels: T[], name: string): T[];
export function parcelQueryUrl(source: OwnerSource, where: string, count?: number): string;
export function sourcesFor(city: string): OwnerSource[];
export function isEntity(owner: string): boolean;
export function entityName(owner: string): string;
export function franchiseUrl(name: string): string;
export function sameEntity(a: string, b: string): boolean;
export function comptrollerUrl(taxpayerNumber: string): string;
export function openCorporatesUrl(name: string): string;
export function readFranchise(row: Record<string, any> | null): Record<string, any> | null;
export function isochroneUrl(lat: number, lng: number, minutes?: number[]): string;
export function inRing(lng: number, lat: number, ring: number[][]): boolean;
export function inGeometry(lng: number, lat: number, geometry: Geometry): boolean;
export function sumInside(tracts: [number, number, number, number][], geometry: Geometry): { people: number; jobs: number; tracts: number };
export function circle(lat: number, lng: number, miles: number, steps?: number): Geometry;
export function readIsochrones(body: any): { minutes: number; geometry: Geometry }[];
export function filterMoves<T extends { city: string; end: string | null; squareFeet: number | null }>(moves: T[], city?: string, today?: string): T[];
export function filterSales<T extends { city: string; saleDate: string | null; value: number | null }>(sales: T[], options?: { city?: string; scheduledOnly?: boolean }): T[];
export function money(value: number | null): string;
export function count(value: number | null): string;
export function dealSteps(deal: any, file: any, analyze: (deal: any) => any): any;
export function saleLinks(sale: { url: string | null; lat: number | null; lng: number | null; address: string; place: string | null; zip: string | null }): { label: string; url: string }[];
export const STATEWIDE_PARCELS: string;
export function geocodeUrl(address: string): string;
export function readGeocode(body: unknown): { lat: number; lng: number } | null;
export function identifyUrl(point: { lat: number; lng: number }, tolerance?: number): string;
export function readStatewide(attributes: Record<string, unknown>): Record<string, any> & { address: string; owner: string; account: string; source: { county: string; name: string; statewide: true } };
export function pickStatewide(body: unknown, address: string): ReturnType<typeof readStatewide>[];
export function isFullAddress(text: string): boolean;
export function geocodeText(address: string, city?: string): string;
