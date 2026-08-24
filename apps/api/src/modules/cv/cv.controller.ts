import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CV_TEMPLATES, DEFAULT_TEMPLATE_KEY } from '@jobpilot/cv';
import {
  CreateMasterCvSchema,
  MAX_CV_UPLOAD_BYTES,
  UpdateMasterCvSchema,
  type CreateMasterCvInput,
  type CvTemplateDto,
  type CvUploadResultDto,
  type MasterCvDetailDto,
  type TailoredCvDetailDto,
  type TailoredCvSummaryDto,
  type MasterCvSummaryDto,
  type UpdateMasterCvInput,
} from '@jobpilot/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AppException } from '../../common/errors/app-exception';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../../common/types/request';
import { CvTailoringService } from './cv-tailoring.service';
import { CvService } from './cv.service';

/** Express's Multer file, typed locally to avoid a dependency on its types. */
interface MulterFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@Controller('cv')
export class CvController {
  constructor(
    private readonly cv: CvService,
    private readonly tailoring: CvTailoringService,
  ) {}

  @Get('templates')
  templates(): CvTemplateDto[] {
    return CV_TEMPLATES.map((template) => ({
      key: template.key,
      name: template.name,
      description: template.description ?? null,
    }));
  }

  /** Every CV tailored to a specific job. */
  @Get('tailored')
  async listTailored(@CurrentUser() user: AuthenticatedUser): Promise<TailoredCvSummaryDto[]> {
    return this.tailoring.list(user.id);
  }

  @Get('tailored/:id')
  async getTailored(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TailoredCvDetailDto> {
    return this.tailoring.get(user.id, id);
  }

  @Get('tailored/:id/download')
  async downloadTailored(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string | undefined,
    @Query('template') template: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (format !== undefined && format !== 'pdf' && format !== 'docx') {
      throw AppException.badRequest('VALIDATION_FAILED', 'Format must be "pdf" or "docx".');
    }

    this.send(
      response,
      await this.tailoring.render(user.id, id, format ?? 'pdf', template ?? DEFAULT_TEMPLATE_KEY),
    );
  }

  /** Rewrites the default CV for one job. */
  @Post('tailor/:jobId')
  async tailor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ): Promise<TailoredCvDetailDto> {
    return this.tailoring.generate(user.id, jobId);
  }

  @Get()
  async list(@CurrentUser() user: AuthenticatedUser): Promise<MasterCvSummaryDto[]> {
    return this.cv.list(user.id);
  }

  /**
   * Uploads a CV.
   *
   * The size cap is enforced by Multer as well as in the service: rejecting at
   * the transport layer means a 200 MB body is refused as it arrives rather
   * than after it has all been buffered into memory.
   */
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_CV_UPLOAD_BYTES, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: MulterFile | undefined,
  ): Promise<CvUploadResultDto> {
    if (!file) {
      throw AppException.badRequest('VALIDATION_FAILED', 'Choose a file to upload.');
    }

    return this.cv.upload(user.id, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      buffer: file.buffer,
    });
  }

  @Post()
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(CreateMasterCvSchema)) body: CreateMasterCvInput,
  ): Promise<MasterCvDetailDto> {
    return this.cv.create(user.id, body);
  }

  @Get(':id')
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MasterCvDetailDto> {
    return this.cv.get(user.id, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateMasterCvSchema)) body: UpdateMasterCvInput,
  ): Promise<MasterCvDetailDto> {
    return this.cv.update(user.id, id, body);
  }

  @Post(':id/set-default')
  async setDefault(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<MasterCvSummaryDto[]> {
    return this.cv.setDefault(user.id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.cv.remove(user.id, id);
  }

  /** Downloads the CV rendered to PDF or DOCX. */
  @Get(':id/download')
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('format') format: string | undefined,
    @Query('template') template: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    if (format !== undefined && format !== 'pdf' && format !== 'docx') {
      throw AppException.badRequest('VALIDATION_FAILED', 'Format must be "pdf" or "docx".');
    }

    const rendered = await this.cv.render(
      user.id,
      id,
      format ?? 'pdf',
      template ?? DEFAULT_TEMPLATE_KEY,
    );

    this.send(response, rendered);
  }

  /** Downloads the file exactly as it was uploaded. */
  @Get(':id/source')
  async source(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() response: Response,
  ): Promise<void> {
    this.send(response, await this.cv.downloadSource(user.id, id));
  }

  private send(
    response: Response,
    file: { buffer: Buffer; filename: string; mimeType: string },
  ): void {
    response.setHeader('Content-Type', file.mimeType);
    // `attachment` matters for more than convenience: it stops a stored file
    // from being rendered inline in the user's origin, which is what turns an
    // uploaded document into stored XSS.
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename.replace(/"/g, '')}"`,
    );
    response.setHeader('Content-Length', String(file.buffer.byteLength));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(file.buffer);
  }
}
