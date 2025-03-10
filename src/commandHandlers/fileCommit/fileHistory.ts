import { inject, injectable } from 'inversify';
import * as path from 'path';
import { Uri } from 'vscode';
import { IApplicationShell } from '../../application/types';
import { ICommandManager } from '../../application/types/commandManager';
import { CompareFileCommitDetails, FileCommitDetails } from '../../common/types';
import { IServiceContainer } from '../../ioc/types';
import { FileNode } from '../../nodes/types';
import { IFileSystem } from '../../platform/types';
import { Hash, IGitServiceFactory, Status } from '../../types';
import { command } from '../registration';
import { IGitFileHistoryCommandHandler } from '../types';

@injectable()
export class GitFileHistoryCommandHandler implements IGitFileHistoryCommandHandler {
    constructor(
        @inject(IServiceContainer) private serviceContainer: IServiceContainer,
        @inject(ICommandManager) private commandManager: ICommandManager,
        @inject(IApplicationShell) private applicationShell: IApplicationShell,
        @inject(IFileSystem) private fileSystem: IFileSystem,
    ) {}

    @command('git.commit.FileEntry.ViewFileContents', IGitFileHistoryCommandHandler)
    public async viewFile(nodeOrFileCommit: FileNode | FileCommitDetails): Promise<void> {
        const fileCommit = nodeOrFileCommit instanceof FileCommitDetails ? nodeOrFileCommit : nodeOrFileCommit.data!;
        const gitService = await this.serviceContainer
            .get<IGitServiceFactory>(IGitServiceFactory)
            .createGitService(fileCommit.workspaceFolder);
        if (fileCommit.committedFile.status === Status.Deleted) {
            return this.applicationShell.showErrorMessage('File cannot be viewed as it was deleted').then(() => void 0);
        }

        const tmpFile = await gitService.getCommitFile(fileCommit.logEntry.hash.full, fileCommit.committedFile.uri);
        await this.commandManager.executeCommand('git.openFileInViewer', tmpFile);
    }

    @command('git.commit.FileEntry.CompareAgainstWorkspace', IGitFileHistoryCommandHandler)
    public async compareFileWithWorkspace(nodeOrFileCommit: FileNode | FileCommitDetails): Promise<void> {
        const fileCommit = nodeOrFileCommit instanceof FileCommitDetails ? nodeOrFileCommit : nodeOrFileCommit.data!;
        const gitService = await this.serviceContainer
            .get<IGitServiceFactory>(IGitServiceFactory)
            .createGitService(fileCommit.workspaceFolder);

        if (fileCommit.committedFile.status === Status.Deleted) {
            return this.applicationShell
                .showErrorMessage('File cannot be compared with, as it was deleted')
                .then(() => void 0);
        }
        if (!(await this.fileSystem.fileExistsAsync(fileCommit.committedFile.uri.path))) {
            return this.applicationShell
                .showErrorMessage('Corresponding workspace file does not exist')
                .then(() => void 0);
        }

        const tmpFile = await gitService.getCommitFile(fileCommit.logEntry.hash.full, fileCommit.committedFile.uri);
        const fileName = path.basename(fileCommit.committedFile.uri.path);
        const title = `${fileName} (${fileCommit.logEntry.hash.short} ↔ Working File)`;
        await this.commandManager.executeCommand(
            'vscode.diff',
            Uri.file(tmpFile.fsPath),
            Uri.file(fileCommit.committedFile.uri.path),
            title,
            { preview: true },
        );
    }

    @command('git.commit.FileEntry.CompareAgainstPrevious', IGitFileHistoryCommandHandler)
    public async compareFileWithPrevious(nodeOrFileCommit: FileNode | FileCommitDetails): Promise<void> {
        const fileCommit = nodeOrFileCommit instanceof FileCommitDetails ? nodeOrFileCommit : nodeOrFileCommit.data!;
        const gitService = await this.serviceContainer
            .get<IGitServiceFactory>(IGitServiceFactory)
            .createGitService(fileCommit.workspaceFolder);

        if (fileCommit.committedFile.status === Status.Deleted) {
            const previousCommitHash = await gitService.getPreviousCommitHashForFile(
                fileCommit.logEntry.hash.full,
                fileCommit.committedFile.uri,
            );
            const previousFile = fileCommit.committedFile.oldUri
                ? fileCommit.committedFile.oldUri
                : fileCommit.committedFile.uri;
            const previousTmpFile = await gitService.getCommitFile(previousCommitHash.full, previousFile);
            await this.commandManager.executeCommand('vscode.open', previousTmpFile);
            return this.applicationShell
                .showErrorMessage('File cannot be compared with, as it was deleted. Showing deleted version.')
                .then(() => void 0);
        } else if (fileCommit.committedFile.status === Status.Added) {
            const tmpFile = await gitService.getCommitFile(fileCommit.logEntry.hash.full, fileCommit.committedFile.uri);
            await this.commandManager.executeCommand('vscode.open', tmpFile);
            return this.applicationShell
                .showErrorMessage('File cannot be compared with previous, as this is a new file. Showing it.')
                .then(() => void 0);
        } else {
            const tmpFile = await gitService.getCommitFile(fileCommit.logEntry.hash.full, fileCommit.committedFile.uri);
            const previousCommitHash = await gitService.getPreviousCommitHashForFile(
                fileCommit.logEntry.hash.full,
                fileCommit.committedFile.uri,
            );

            const previousFile = fileCommit.committedFile.oldUri
                ? fileCommit.committedFile.oldUri
                : fileCommit.committedFile.uri;
            const previousTmpFile = await gitService.getCommitFile(previousCommitHash.full, previousFile);

            const title = this.getComparisonTitle(
                { file: Uri.file(previousFile.path), hash: previousCommitHash },
                { file: Uri.file(fileCommit.committedFile.uri.path), hash: fileCommit.logEntry.hash },
            );
            await this.commandManager.executeCommand('vscode.diff', previousTmpFile, tmpFile, title, { preview: true });
        }
    }
    @command('git.commit.FileEntry.ViewPreviousFileContents', IGitFileHistoryCommandHandler)
    public async viewPreviousFile(nodeOrFileCommit: FileNode | FileCommitDetails): Promise<void> {
        const fileCommit = nodeOrFileCommit instanceof FileCommitDetails ? nodeOrFileCommit : nodeOrFileCommit.data!;
        const gitService = await this.serviceContainer
            .get<IGitServiceFactory>(IGitServiceFactory)
            .createGitService(fileCommit.workspaceFolder);

        if (fileCommit.committedFile.status === Status.Added) {
            return this.applicationShell
                .showErrorMessage('Previous version of the file cannot be opened, as this is a new file')
                .then(() => void 0);
        }

        const previousCommitHash = await gitService.getPreviousCommitHashForFile(
            fileCommit.logEntry.hash.full,
            fileCommit.committedFile.uri,
        );

        const previousFile = fileCommit.committedFile.oldUri
            ? fileCommit.committedFile.oldUri
            : fileCommit.committedFile.uri;
        const previousTmpFile = await gitService.getCommitFile(previousCommitHash.full, previousFile);

        await this.commandManager.executeCommand('git.openFileInViewer', Uri.file(previousTmpFile.fsPath));
    }
    @command('git.commit.compare.file.compare', IGitFileHistoryCommandHandler)
    public async compareFileAcrossCommits(fileCommit: CompareFileCommitDetails): Promise<void> {
        const gitService = await this.serviceContainer
            .get<IGitServiceFactory>(IGitServiceFactory)
            .createGitService(fileCommit.workspaceFolder);

        if (fileCommit.committedFile.status === Status.Deleted) {
            return this.applicationShell
                .showErrorMessage('File cannot be compared with, as it was deleted')
                .then(() => void 0);
        }
        if (fileCommit.committedFile.status === Status.Added) {
            return this.applicationShell
                .showErrorMessage('File cannot be compared, as this is a new file')
                .then(() => void 0);
        }

        const leftFilePromise = gitService.getCommitFile(fileCommit.logEntry.hash.full, fileCommit.committedFile.uri);
        const rightFilePromise = gitService.getCommitFile(
            fileCommit.rightCommit.logEntry.hash.full,
            fileCommit.committedFile.uri,
        );

        const [leftFile, rightFile] = await Promise.all([leftFilePromise, rightFilePromise]);

        const title = this.getComparisonTitle(
            { file: Uri.file(fileCommit.committedFile.uri.path), hash: fileCommit.logEntry.hash },
            { file: Uri.file(fileCommit.committedFile.uri.path), hash: fileCommit.rightCommit.logEntry.hash },
        );

        await this.commandManager.executeCommand('vscode.diff', leftFile, rightFile, title, { preview: true });
    }
    private getComparisonTitle(left: { file: Uri; hash: Hash }, right: { file: Uri; hash: Hash }) {
        const leftFileName = path.basename(left.file.fsPath);
        const rightFileName = path.basename(right.file.fsPath);
        if (leftFileName === rightFileName) {
            return `${leftFileName} (${left.hash.short} ↔ ${right.hash.short})`;
        } else {
            return `${leftFileName} (${left.hash.short} ↔ ${rightFileName} ${right.hash.short})`;
        }
    }
}
