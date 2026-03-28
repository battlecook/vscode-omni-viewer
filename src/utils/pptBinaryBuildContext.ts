import type {
    PptColorScheme,
    PptPictureAsset,
    PptPresentationMetrics,
    PptRecord,
    PptTextBlock
} from './pptBinaryTypes';

export function normalizeBuildSlidesArgs(
    slideRecords: PptRecord[],
    pictures: PptPictureAsset[],
    outlineTextByPersistId: Map<number, PptTextBlock[]>,
    defaultColorScheme: PptColorScheme | null,
    masterRecordOrPresentationMetrics: PptRecord | PptPresentationMetrics | null,
    presentationMetricsOrWidth: PptPresentationMetrics | number | null,
    widthPxOrHeight: number,
    heightPxOrPicturesById?: number | Map<number, PptPictureAsset>,
    picturesByIdMaybe?: Map<number, PptPictureAsset>
): {
    slideRecords: PptRecord[];
    pictures: PptPictureAsset[];
    outlineTextByPersistId: Map<number, PptTextBlock[]>;
    defaultColorScheme: PptColorScheme | null;
    masterRecord: PptRecord | null;
    presentationMetrics: PptPresentationMetrics | null;
    widthPx: number;
    heightPx: number;
    picturesById?: Map<number, PptPictureAsset>;
} {
    const isPresentationMetrics = (
        value: PptRecord | PptPresentationMetrics | number | null | undefined
    ): value is PptPresentationMetrics => !!value
        && typeof value === 'object'
        && 'rawWidth' in value
        && 'rawHeight' in value;

    const isPptRecord = (value: PptRecord | PptPresentationMetrics | null): value is PptRecord => !!value
        && typeof value === 'object'
        && 'recType' in value
        && 'payload' in value;

    const masterRecord = isPptRecord(masterRecordOrPresentationMetrics)
        ? masterRecordOrPresentationMetrics
        : null;
    const presentationMetrics = isPptRecord(masterRecordOrPresentationMetrics)
        ? (isPresentationMetrics(presentationMetricsOrWidth) ? presentationMetricsOrWidth : null)
        : (isPresentationMetrics(masterRecordOrPresentationMetrics)
            ? masterRecordOrPresentationMetrics
            : (isPresentationMetrics(presentationMetricsOrWidth) ? presentationMetricsOrWidth : null));
    const widthPx = typeof heightPxOrPicturesById === 'number'
        ? widthPxOrHeight
        : typeof presentationMetricsOrWidth === 'number'
            ? presentationMetricsOrWidth
            : widthPxOrHeight;
    const heightPx = typeof heightPxOrPicturesById === 'number'
        ? heightPxOrPicturesById
        : widthPxOrHeight;
    const picturesById = heightPxOrPicturesById instanceof Map
        ? heightPxOrPicturesById
        : picturesByIdMaybe;

    return {
        slideRecords,
        pictures,
        outlineTextByPersistId,
        defaultColorScheme,
        masterRecord,
        presentationMetrics,
        widthPx,
        heightPx,
        picturesById
    };
}
