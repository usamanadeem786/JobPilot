import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { OAuthService } from './oauth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/**
 * `JwtModule` is registered without a secret on purpose: access and refresh
 * tokens are signed with different keys, so every call passes its own secret.
 * A module-level default would make it easy to sign the wrong token type.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, OAuthService, PasswordService, TokenService, JwtAuthGuard],
  exports: [AuthService, OAuthService, TokenService, JwtAuthGuard],
})
export class AuthModule {}
