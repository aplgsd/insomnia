// @flow
import * as React from 'react';
import autobind from 'autobind-decorator';
import Modal from '../base/modal';
import ModalBody from '../base/modal-body';
import ModalHeader from '../base/modal-header';
import ModalFooter from '../base/modal-footer';
import { FileSystemDriver, VCS } from 'insomnia-sync';
import type { Workspace } from '../../../models/workspace';
import * as db from '../../../common/database';
import * as models from '../../../models';
import PromptButton from '../base/prompt-button';
import * as session from '../../../sync/session';
import TimeFromNow from '../time-from-now';

type Props = {
  workspace: Workspace,
};

type State = {
  branch: string,
  actionBranch: string,
  branches: Array<string>,
  history: Array<Snapshot>,
  status: Status,
  message: string,
  error: string,
  newBranchName: string,
};

const WHITE_LIST = {
  [models.workspace.type]: true,
  [models.request.type]: true,
  [models.requestGroup.type]: true,
  [models.environment.type]: true,
};

@autobind
class SyncStagingModal extends React.PureComponent<Props, State> {
  modal: ?Modal;
  vcs: VCS;

  constructor(props: Props) {
    super(props);
    this.state = {
      branch: '',
      actionBranch: '',
      branches: [],
      newBranchName: '',
      history: [],
      status: {
        stage: {},
        unstaged: {},
      },
      error: '',
      message: '',
    };

    const driver = new FileSystemDriver({ directory: '/Users/gschier/Desktop/vcs' });
    const author = session.getAccountId() || 'account_1';
    this.vcs = new VCS(
      // 'prj_e604382c34dc4399beb3860551db7ae5' // Dev,
      'prj_15e703454c1841a79c88d5244fa0f2e5', // Staging,
      driver,
      author,
      'https://api.staging.insomnia.rest/graphql/',
      '9cb9c29ee36e74e5b0b8c68f4de9d80124176c5ba6e32440a70a6d63adae9d72', // Staging
      // session.getCurrentSessionId(),
    );
  }

  async componentDidMount() {
    await this.show();
  }

  _setModalRef(m: ?Modal) {
    this.modal = m;
  }

  _handleDone() {
    this.hide();
  }

  _handleMessageChange(e: SyntheticEvent<HTMLInputElement>) {
    this.setState({ message: e.currentTarget.value });
  }

  _handleBranchChange(e: SyntheticEvent<HTMLInputElement>) {
    this.setState({ newBranchName: e.currentTarget.value });
  }

  async _handleChangeBranch(e: SyntheticEvent<HTMLSelectElement>) {
    await this.vcs.checkout(e.currentTarget.value);
    await this.updateStatus();
  }

  async _handleChangeActionBranch(e: SyntheticEvent<HTMLSelectElement>) {
    this.setState({ actionBranch: e.currentTarget.value });
  }

  async _handleFork(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const { newBranchName } = this.state;
    await this.vcs.fork(newBranchName);
    await this.updateStatus({ newBranchName: '' });
  }

  async _handleRemoveBranch() {
    const { actionBranch } = this.state;

    try {
      await this.vcs.removeBranch(actionBranch);
    } catch (err) {
      // Failed, probably because it's the current branch
      console.log('[vcs] Failed to remove branch', err);
      return;
    }

    await this.updateStatus({ actionBranch: '' });
  }

  async _handleMergeBranch() {
    const { actionBranch } = this.state;

    try {
      await this.vcs.merge(actionBranch);
    } catch (err) {
      // Failed, probably because it's the current branch
      console.log('[vcs] Failed to merge branch', err);
      return;
    }

    await this.updateStatus();
  }

  async _handleStage(e: SyntheticEvent<HTMLInputElement>) {
    const id = e.currentTarget.name;
    const statusItem = this.state.status.unstaged[id];
    await this.vcs.stage(statusItem);
    await this.updateStatus();
  }

  async _handleStageAll() {
    const { unstaged } = this.state.status;
    for (const id of Object.keys(unstaged)) {
      await this.vcs.stage(unstaged[id]);
    }

    await this.updateStatus();
  }

  async _handleUnstageAll() {
    const { stage } = this.state.status;
    for (const id of Object.keys(stage)) {
      await this.vcs.unstage(stage[id]);
    }

    await this.updateStatus();
  }

  async _handleUnstage(e: SyntheticEvent<HTMLInputElement>) {
    const id = e.currentTarget.name;
    const statusItem = this.state.status.stage[id];
    await this.vcs.unstage(statusItem);
    await this.updateStatus();
  }

  async _handlePushChanges() {
    try {
      await this.vcs.push();
    } catch (err) {
      this.setState({ error: err.message });
      return;
    }

    await this.updateStatus({ error: '' });
  }

  async _handleTakeSnapshot() {
    try {
      const { message } = this.state;
      await this.vcs.takeSnapshot(message);
    } catch (err) {
      this.setState({ error: err.message });
      return;
    }

    await this.updateStatus({ message: '', error: '' });
  }

  async updateStatus(newState?: Object) {
    const items = [];
    const allDocs = await db.withDescendants(this.props.workspace);
    const docs = allDocs.filter(d => WHITE_LIST[d.type] && !(d: any).isPrivate);

    for (const doc of docs) {
      items.push({
        key: doc._id,
        name: (doc: any).name || 'No Name',
        content: doc,
      });
    }

    const status = await this.vcs.status(items);
    const branch = await this.vcs.getBranchName();
    const branches = await this.vcs.getBranchNames();
    const history = await this.vcs.getBranchHistory(branch);
    this.setState({
      status,
      branch,
      branches,
      history: history.sort((a, b) => (a.created < b.created ? 1 : -1)),
      error: '',
      ...newState,
    });
  }

  hide() {
    this.modal && this.modal.hide();
  }

  async show() {
    this.modal && this.modal.show();
    await this.updateStatus();
  }

  render() {
    const {
      actionBranch,
      branch,
      branches,
      history,
      newBranchName,
      status,
      message,
      error,
    } = this.state;

    return (
      <Modal ref={this._setModalRef}>
        <ModalHeader>Stage Files</ModalHeader>
        <ModalBody className="wide pad">
          <div className="form-row">
            <div className="form-control form-control--outlined">
              <select value={branch} onChange={this._handleChangeBranch}>
                {branches.map(b => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-control form-control--outlined">
              <select value={actionBranch} onChange={this._handleChangeActionBranch}>
                <option value="">-- Select Branch --</option>
                {branches.map(b => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <PromptButton
              className="btn btn--clicky width-auto"
              onClick={this._handleRemoveBranch}
              disabled={!actionBranch || actionBranch === branch}
              addIcon
              confirmMessage=" ">
              <i className="fa fa-trash-o" />
            </PromptButton>
            <PromptButton
              className="btn btn--clicky width-auto"
              onClick={this._handleMergeBranch}
              disabled={!actionBranch || actionBranch === branch}
              addIcon
              confirmMessage=" ">
              <i className="fa fa-code-fork" />
            </PromptButton>
          </div>
          <form onSubmit={this._handleFork}>
            <div className="form-row">
              <div className="form-control form-control--outlined">
                <input
                  key={branch}
                  type="text"
                  placeholder="my-branch"
                  onChange={this._handleBranchChange}
                  defaultValue={newBranchName}
                />
              </div>
              <button type="submit" className="btn btn--clicky width-auto">
                Create Branch
              </button>
            </div>
          </form>
          <div className="form-group">
            <div className="form-control form-control--outlined">
              <textarea
                cols="30"
                rows="3"
                onChange={this._handleMessageChange}
                value={message}
                placeholder="My commit message"
              />
            </div>
            <button className="btn btn--clicky space-left" onClick={this._handleTakeSnapshot}>
              Take Snapshot
            </button>
            <button className="btn btn--clicky space-left" onClick={this._handlePushChanges}>
              Push Changes
            </button>
          </div>
          {error && <div className="text-danger">{error}</div>}
          <div>
            <button
              className="pull-right btn btn--clicky-small"
              disabled={Object.keys(status.stage).length === 0}
              onClick={this._handleUnstageAll}>
              Remove All
            </button>
            <h2>Added Changes</h2>
          </div>
          <ul>
            {Object.keys(status.stage)
              .sort()
              .map(key => (
                <li key={key}>
                  <label>
                    <input
                      className="space-right"
                      type="checkbox"
                      checked={true}
                      name={key}
                      onChange={this._handleUnstage}
                    />
                    <code className="txt-sm pad-xxs">{status.stage[key].operation}</code>{' '}
                    {status.stage[key].name}
                  </label>
                </li>
              ))}
          </ul>
          <div>
            <button
              className="pull-right btn btn--clicky-small"
              onClick={this._handleStageAll}
              disabled={Object.keys(status.unstaged).length === 0}>
              Add All
            </button>
            <h2>Changes</h2>
          </div>
          <ul>
            {Object.keys(status.unstaged)
              .sort()
              .map(id => (
                <li key={`${id}::${status.unstaged[id].blob}`}>
                  <label>
                    <input
                      className="space-right"
                      type="checkbox"
                      checked={false}
                      name={id}
                      onChange={this._handleStage}
                    />
                    <code className="small pad-xxs">{status.unstaged[id].operation}</code>{' '}
                    {status.unstaged[id].name}
                  </label>
                </li>
              ))}
          </ul>
          <br />
          <h2>History</h2>
          <table className="table--fancy table--striped">
            <thead>
              <tr>
                <th className="text-left">Hash</th>
                <th className="text-left">Time</th>
                <th className="text-left">Message</th>
                <th className="text-left">Count</th>
              </tr>
            </thead>
            <tbody>
              {history.map(snapshot => (
                <tr key={snapshot.id}>
                  <td className="monospace txt-sm">{snapshot.id}</td>
                  <td>
                    <TimeFromNow timestamp={snapshot.created} intervalSeconds={30} />
                  </td>
                  <td>{snapshot.name}</td>
                  <td>{snapshot.state.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ModalBody>
        <ModalFooter>
          <div>
            <button className="btn" onClick={this.hide}>
              Cancel
            </button>
            <button className="btn" onClick={this._handleDone}>
              Ok
            </button>
          </div>
        </ModalFooter>
      </Modal>
    );
  }
}

export default SyncStagingModal;