import * as vscode from 'vscode';
import { A2lViewerProvider } from './a2lViewerProvider';
import { ArxmlViewerProvider } from './arxmlViewerProvider';
import { ArchiveViewerProvider } from './archiveViewerProvider';
import { AscViewerProvider } from './ascViewerProvider';
import { AudioViewerProvider } from './audioViewerProvider';
import { AvroViewerProvider } from './avroViewerProvider';
import { BagViewerProvider } from './bagViewerProvider';
import { BlfViewerProvider } from './blfViewerProvider';
import { CsvViewerProvider } from './csvViewerProvider';
import { Db3ViewerProvider } from './db3ViewerProvider';
import { DbcViewerProvider } from './dbcViewerProvider';
import { ExcelViewerProvider } from './excelViewerProvider';
import { Hdf5ViewerProvider } from './hdf5ViewerProvider';
import { HwpViewerProvider } from './hwpViewerProvider';
import { ImageViewerProvider } from './imageViewerProvider';
import { JsonViewerProvider } from './jsonViewerProvider';
import { JsonlViewerProvider } from './jsonlViewerProvider';
import { MatViewerProvider } from './matViewerProvider';
import { MarkdownViewerProvider } from './markdownViewerProvider';
import { MermaidViewerProvider } from './mermaidViewerProvider';
import { Mf4ViewerProvider } from './mf4ViewerProvider';
import { ParquetViewerProvider } from './parquetViewerProvider';
import { PcapViewerProvider } from './pcapViewerProvider';
import { PcapngViewerProvider } from './pcapngViewerProvider';
import { PdfViewerProvider } from './pdfViewerProvider';
import { PlantumlViewerProvider } from './plantumlViewerProvider';
import { PptViewerProvider } from './pptViewerProvider';
import { ProtoViewerProvider } from './protoViewerProvider';
import { PsdViewerProvider } from './psdViewerProvider';
import { ReqifViewerProvider } from './reqifViewerProvider';
import { ShpViewerProvider } from './shpViewerProvider';
import { StpViewerProvider } from './stpViewerProvider';
import { TomlViewerProvider } from './tomlViewerProvider';
import { VideoViewerProvider } from './videoViewerProvider';
import { WordViewerProvider } from './wordViewerProvider';
import { YamlViewerProvider } from './yamlViewerProvider';
import { OmniViewerViewType } from './utils/fileUtils';

export interface ViewerRegistration {
    viewType: OmniViewerViewType;
    command: string;
    missingMessage: string;
    retainContextWhenHidden: boolean;
    createProvider: (context: vscode.ExtensionContext) => vscode.CustomReadonlyEditorProvider;
}

export const VIEWER_REGISTRATIONS: ViewerRegistration[] = [
    {
        viewType: ArchiveViewerProvider.viewType,
        command: 'omni-viewer.openArchiveViewer',
        missingMessage: 'No archive file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ArchiveViewerProvider(context)
    },
    {
        viewType: AudioViewerProvider.viewType,
        command: 'omni-viewer.openAudioViewer',
        missingMessage: 'No audio file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new AudioViewerProvider(context)
    },
    {
        viewType: ImageViewerProvider.viewType,
        command: 'omni-viewer.openImageViewer',
        missingMessage: 'No image file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ImageViewerProvider(context)
    },
    {
        viewType: VideoViewerProvider.viewType,
        command: 'omni-viewer.openVideoViewer',
        missingMessage: 'No video file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new VideoViewerProvider(context)
    },
    {
        viewType: CsvViewerProvider.viewType,
        command: 'omni-viewer.openCsvViewer',
        missingMessage: 'No CSV file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new CsvViewerProvider(context)
    },
    {
        viewType: DbcViewerProvider.viewType,
        command: 'omni-viewer.openDbcViewer',
        missingMessage: 'No DBC file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new DbcViewerProvider(context)
    },
    {
        viewType: ArxmlViewerProvider.viewType,
        command: 'omni-viewer.openArxmlViewer',
        missingMessage: 'No ARXML file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ArxmlViewerProvider(context)
    },
    {
        viewType: A2lViewerProvider.viewType,
        command: 'omni-viewer.openA2lViewer',
        missingMessage: 'No A2L file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new A2lViewerProvider(context)
    },
    {
        viewType: AscViewerProvider.viewType,
        command: 'omni-viewer.openAscViewer',
        missingMessage: 'No ASC file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new AscViewerProvider(context)
    },
    {
        viewType: BlfViewerProvider.viewType,
        command: 'omni-viewer.openBlfViewer',
        missingMessage: 'No BLF file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new BlfViewerProvider(context)
    },
    {
        viewType: Mf4ViewerProvider.viewType,
        command: 'omni-viewer.openMf4Viewer',
        missingMessage: 'No MF4 file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new Mf4ViewerProvider(context)
    },
    {
        viewType: AvroViewerProvider.viewType,
        command: 'omni-viewer.openAvroViewer',
        missingMessage: 'No Avro file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new AvroViewerProvider(context)
    },
    {
        viewType: BagViewerProvider.viewType,
        command: 'omni-viewer.openBagViewer',
        missingMessage: 'No BAG file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new BagViewerProvider(context)
    },
    {
        viewType: StpViewerProvider.viewType,
        command: 'omni-viewer.openStpViewer',
        missingMessage: 'No STEP file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new StpViewerProvider(context)
    },
    {
        viewType: Db3ViewerProvider.viewType,
        command: 'omni-viewer.openDb3Viewer',
        missingMessage: 'No DB3 file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new Db3ViewerProvider(context)
    },
    {
        viewType: ReqifViewerProvider.viewType,
        command: 'omni-viewer.openReqifViewer',
        missingMessage: 'No ReqIF file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ReqifViewerProvider(context)
    },
    {
        viewType: PcapViewerProvider.viewType,
        command: 'omni-viewer.openPcapViewer',
        missingMessage: 'No PCAP file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new PcapViewerProvider(context)
    },
    {
        viewType: PcapngViewerProvider.viewType,
        command: 'omni-viewer.openPcapngViewer',
        missingMessage: 'No PCAPNG file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new PcapngViewerProvider(context)
    },
    {
        viewType: JsonViewerProvider.viewType,
        command: 'omni-viewer.openJsonViewer',
        missingMessage: 'No JSON file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new JsonViewerProvider(context)
    },
    {
        viewType: YamlViewerProvider.viewType,
        command: 'omni-viewer.openYamlViewer',
        missingMessage: 'No YAML file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new YamlViewerProvider(context)
    },
    {
        viewType: JsonlViewerProvider.viewType,
        command: 'omni-viewer.openJsonlViewer',
        missingMessage: 'No JSONL file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new JsonlViewerProvider(context)
    },
    {
        viewType: TomlViewerProvider.viewType,
        command: 'omni-viewer.openTomlViewer',
        missingMessage: 'No TOML file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new TomlViewerProvider(context)
    },
    {
        viewType: MarkdownViewerProvider.viewType,
        command: 'omni-viewer.openMarkdownViewer',
        missingMessage: 'No Markdown file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new MarkdownViewerProvider(context)
    },
    {
        viewType: MermaidViewerProvider.viewType,
        command: 'omni-viewer.openMermaidViewer',
        missingMessage: 'No Mermaid file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new MermaidViewerProvider(context)
    },
    {
        viewType: PlantumlViewerProvider.viewType,
        command: 'omni-viewer.openPlantumlViewer',
        missingMessage: 'No PlantUML file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new PlantumlViewerProvider(context)
    },
    {
        viewType: ProtoViewerProvider.viewType,
        command: 'omni-viewer.openProtoViewer',
        missingMessage: 'No Proto file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ProtoViewerProvider(context)
    },
    {
        viewType: ParquetViewerProvider.viewType,
        command: 'omni-viewer.openParquetViewer',
        missingMessage: 'No Parquet file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ParquetViewerProvider(context)
    },
    {
        viewType: ShpViewerProvider.viewType,
        command: 'omni-viewer.openShpViewer',
        missingMessage: 'No Shapefile selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ShpViewerProvider(context)
    },
    {
        viewType: Hdf5ViewerProvider.viewType,
        command: 'omni-viewer.openHdf5Viewer',
        missingMessage: 'No HDF5 file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new Hdf5ViewerProvider(context)
    },
    {
        viewType: MatViewerProvider.viewType,
        command: 'omni-viewer.openMatViewer',
        missingMessage: 'No MAT file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new MatViewerProvider(context)
    },
    {
        viewType: HwpViewerProvider.viewType,
        command: 'omni-viewer.openHwpViewer',
        missingMessage: 'No HWP file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new HwpViewerProvider(context)
    },
    {
        viewType: PsdViewerProvider.viewType,
        command: 'omni-viewer.openPsdViewer',
        missingMessage: 'No PSD file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new PsdViewerProvider(context)
    },
    {
        viewType: ExcelViewerProvider.viewType,
        command: 'omni-viewer.openExcelViewer',
        missingMessage: 'No Excel file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new ExcelViewerProvider(context)
    },
    {
        viewType: WordViewerProvider.viewType,
        command: 'omni-viewer.openWordViewer',
        missingMessage: 'No Word file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new WordViewerProvider(context)
    },
    {
        viewType: PdfViewerProvider.viewType,
        command: 'omni-viewer.openPdfViewer',
        missingMessage: 'No PDF file selected',
        retainContextWhenHidden: false,
        createProvider: (context) => new PdfViewerProvider(context)
    },
    {
        viewType: PptViewerProvider.viewType,
        command: 'omni-viewer.openPptViewer',
        missingMessage: 'No PowerPoint file selected',
        retainContextWhenHidden: true,
        createProvider: (context) => new PptViewerProvider(context)
    }
];
