"use client";

import Link from "next/link";
import { LocationCheckin } from "@/components/checkin/location-checkin";
import { DistanceCheck } from "./distance-check";
import { navigationUrl } from "@/lib/client/format";

export interface PlaceActionData {
  id: string;
  slug: string;
  nameZh: string;
  nameJa: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  methods: { location: boolean; photo: boolean };
  closed: boolean;
}

export function PlaceActions({ place }: { place: PlaceActionData }) {
  return (
    <div className="ticket space-y-4 p-5">
      <p className="eyebrow">打卡</p>
      {place.closed ? (
        <p className="notice notice-warn text-sm">这个地点暂时关闭，暂不接受新的打卡。已有记录会保留。</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className="font-bold">定位打卡</p>
            <p className="text-sm text-ink-2">
              在打卡点 {place.radiusMeters} m 范围内、定位精度 50 m 以内即可通过。
            </p>
            <LocationCheckin placeId={place.id} placeName={place.nameZh} />
          </div>
          <div className="perforation" />
          <div className="space-y-1.5">
            <p className="font-bold">拍照打卡</p>
            {place.methods.photo ? (
              <>
                <p className="text-sm text-ink-2">先核对照片是否拍摄于这里，匹配后再评价摄影表现。不需要同时定位。</p>
                <Link href={`/checkin/${place.id}`} className="btn btn-primary btn-block">
                  拍照打卡
                </Link>
              </>
            ) : (
              <p className="text-sm text-muted">这个地点暂不支持照片核验（缺少足够的可辨识特征或授权参考图），请使用定位打卡。</p>
            )}
          </div>
        </>
      )}
      <div className="perforation" />
      <DistanceCheck place={place} />
      <a href={navigationUrl(place)} target="_blank" rel="noreferrer" className="btn btn-quiet btn-block">
        打开导航（外部地图）
      </a>
    </div>
  );
}
