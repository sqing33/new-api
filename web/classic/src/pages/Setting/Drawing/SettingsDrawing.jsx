/*
Copyright (C) 2025 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/

import React, { useEffect, useMemo, useState, useRef } from 'react';
import {
  Button,
  Col,
  Form,
  Input,
  Row,
  Select,
  Spin,
  Tag,
  TextArea,
  Typography,
} from '@douyinfe/semi-ui';
import {
  compareObjects,
  API,
  showError,
  showSuccess,
  showWarning,
} from '../../../helpers';
import { useTranslation } from 'react-i18next';

const { Text } = Typography;

const DEFAULT_INPUTS = {
  DrawingEnabled: false,
  MjNotifyEnabled: false,
  MjAccountFilterEnabled: false,
  MjForwardUrlEnabled: false,
  MjModeClearEnabled: false,
  MjActionCheckSuccessEnabled: false,
  HomePageMode: 'image_showcase',
  HomeGalleryImages: '',
};

const EMPTY_GALLERY_ITEM = {
  imageUrl: '',
  title: '',
  prompt: '',
  model: '',
  tag: '',
  aspect: 'square',
};

const normalizeGalleryItem = (item = {}) => ({
  imageUrl: String(item.imageUrl || '').trim(),
  title: String(item.title || '').trim(),
  prompt: String(item.prompt || '').trim(),
  model: String(item.model || '').trim(),
  tag: String(item.tag || '').trim(),
  aspect: ['square', 'portrait', 'landscape'].includes(item.aspect)
    ? item.aspect
    : 'square',
});

const parseGalleryImages = (value) => {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeGalleryItem);
  } catch {
    return [];
  }
};

const stringifyGalleryImages = (items) =>
  JSON.stringify(
    items.map(normalizeGalleryItem).filter((item) => item.imageUrl),
    null,
    2,
  );

export default function SettingsDrawing(props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [inputs, setInputs] = useState(DEFAULT_INPUTS);
  const refForm = useRef();
  const [inputsRow, setInputsRow] = useState(inputs);
  const [galleryItems, setGalleryItems] = useState([]);
  const [gallerySearch, setGallerySearch] = useState('');

  const filteredGalleryItems = useMemo(() => {
    const keyword = gallerySearch.trim().toLowerCase();
    if (!keyword) return galleryItems.map((item, index) => ({ item, index }));
    return galleryItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) =>
        [item.title, item.prompt, item.model, item.tag, item.imageUrl]
          .join(' ')
          .toLowerCase()
          .includes(keyword),
      );
  }, [galleryItems, gallerySearch]);

  const updateInputs = (patch) => {
    setInputs((current) => ({ ...current, ...patch }));
  };

  const updateGalleryItems = (nextItems) => {
    const nextJson = stringifyGalleryImages(nextItems);
    setGalleryItems(nextItems);
    updateInputs({ HomeGalleryImages: nextJson });
  };

  const updateGalleryItem = (index, key, value) => {
    updateGalleryItems(
      galleryItems.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [key]: value } : item,
      ),
    );
  };

  function onSubmit() {
    const updateArray = compareObjects(inputs, inputsRow);
    if (!updateArray.length) return showWarning(t('你似乎并没有修改什么'));
    const requestQueue = updateArray.map((item) => {
      let value = '';
      if (typeof inputs[item.key] === 'boolean') {
        value = String(inputs[item.key]);
      } else {
        value = inputs[item.key];
      }
      return API.put('/api/option/', {
        key: item.key,
        value,
      });
    });
    setLoading(true);
    Promise.all(requestQueue)
      .then((res) => {
        if (requestQueue.length === 1) {
          if (res.includes(undefined)) return;
        } else if (requestQueue.length > 1) {
          if (res.includes(undefined))
            return showError(t('部分保存失败，请重试'));
        }
        showSuccess(t('保存成功'));
        props.refresh();
      })
      .catch(() => {
        showError(t('保存失败，请重试'));
      })
      .finally(() => {
        setLoading(false);
      });
  }

  useEffect(() => {
    const currentInputs = { ...DEFAULT_INPUTS };
    for (let key in props.options) {
      if (Object.keys(DEFAULT_INPUTS).includes(key)) {
        currentInputs[key] = props.options[key];
      }
    }
    setInputs(currentInputs);
    setInputsRow(structuredClone(currentInputs));
    setGalleryItems(parseGalleryImages(currentInputs.HomeGalleryImages));
    refForm.current?.setValues(currentInputs);
    localStorage.setItem(
      'mj_notify_enabled',
      String(currentInputs.MjNotifyEnabled),
    );
  }, [props.options]);

  return (
    <>
      <Spin spinning={loading}>
        <Form
          values={inputs}
          getFormApi={(formAPI) => (refForm.current = formAPI)}
          style={{ marginBottom: 15 }}
        >
          <Form.Section text={t('绘图设置')}>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'DrawingEnabled'}
                  label={t('启用绘图功能')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) => {
                    setInputs({
                      ...inputs,
                      DrawingEnabled: value,
                    });
                  }}
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'MjNotifyEnabled'}
                  label={t('允许回调（会泄露服务器 IP 地址）')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      MjNotifyEnabled: value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'MjAccountFilterEnabled'}
                  label={t('允许 AccountFilter 参数')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      MjAccountFilterEnabled: value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'MjForwardUrlEnabled'}
                  label={t('开启之后将上游地址替换为服务器地址')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      MjForwardUrlEnabled: value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'MjModeClearEnabled'}
                  label={
                    <>
                      {t('开启之后会清除用户提示词中的')} <Tag>--fast</Tag> 、
                      <Tag>--relax</Tag> {t('以及')} <Tag>--turbo</Tag>{' '}
                      {t('参数')}
                    </>
                  }
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      MjModeClearEnabled: value,
                    })
                  }
                />
              </Col>
              <Col xs={24} sm={12} md={8} lg={8} xl={8}>
                <Form.Switch
                  field={'MjActionCheckSuccessEnabled'}
                  label={t('检测必须等待绘图成功才能进行放大等操作')}
                  size='default'
                  checkedText='｜'
                  uncheckedText='〇'
                  onChange={(value) =>
                    setInputs({
                      ...inputs,
                      MjActionCheckSuccessEnabled: value,
                    })
                  }
                />
              </Col>
            </Row>

            <div
              style={{
                borderTop: '1px solid var(--semi-color-border)',
                marginTop: 20,
                paddingTop: 20,
              }}
            >
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                  <div className='flex flex-col gap-2'>
                    <Text strong>{t('首页模式')}</Text>
                    <Select
                      optionList={[
                        {
                          label: t('生图展示页'),
                          value: 'image_showcase',
                        },
                        {
                          label: t('自定义内容'),
                          value: 'custom_content',
                        },
                      ]}
                      onChange={(value) =>
                        updateInputs({ HomePageMode: value })
                      }
                      value={inputs.HomePageMode}
                    />
                    <Text type='tertiary' size='small'>
                      {t(
                        '选择首页展示生图作品集，或继续使用原有 Markdown/iframe 内容。',
                      )}
                    </Text>
                  </div>
                </Col>
                <Col xs={24} md={16}>
                  <div className='flex flex-col gap-2'>
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <Text strong>{t('首页展示图集')}</Text>
                      <div className='flex flex-wrap items-center gap-2'>
                        <Input
                          placeholder={t('搜索图片项')}
                          onChange={setGallerySearch}
                          value={gallerySearch}
                          style={{ width: 180 }}
                        />
                        <Button
                          onClick={() =>
                            updateGalleryItems([
                              ...galleryItems,
                              { ...EMPTY_GALLERY_ITEM },
                            ])
                          }
                        >
                          {t('新增图片')}
                        </Button>
                      </div>
                    </div>
                    <Text type='tertiary' size='small'>
                      {t('图集为空时，首页会使用前端内置默认图集兜底。')}
                    </Text>
                  </div>
                </Col>
              </Row>

              <div className='mt-4 flex flex-col gap-3'>
                {filteredGalleryItems.length === 0 ? (
                  <div className='rounded-md border border-dashed border-semi-color-border p-4 text-sm text-semi-color-text-2'>
                    {t('暂无图片项')}
                  </div>
                ) : (
                  filteredGalleryItems.map(({ item, index }) => (
                    <div
                      key={index}
                      className='rounded-md border border-semi-color-border bg-semi-color-bg-1 p-3'
                    >
                      <Row gutter={[12, 12]}>
                        <Col xs={24} md={8}>
                          <Input
                            placeholder={t('图片 URL')}
                            value={item.imageUrl}
                            onChange={(value) =>
                              updateGalleryItem(index, 'imageUrl', value)
                            }
                          />
                        </Col>
                        <Col xs={24} md={4}>
                          <Input
                            placeholder={t('作品标题')}
                            value={item.title}
                            onChange={(value) =>
                              updateGalleryItem(index, 'title', value)
                            }
                          />
                        </Col>
                        <Col xs={12} md={4}>
                          <Input
                            placeholder={t('模型名')}
                            value={item.model}
                            onChange={(value) =>
                              updateGalleryItem(index, 'model', value)
                            }
                          />
                        </Col>
                        <Col xs={12} md={3}>
                          <Input
                            placeholder={t('风格标签')}
                            value={item.tag}
                            onChange={(value) =>
                              updateGalleryItem(index, 'tag', value)
                            }
                          />
                        </Col>
                        <Col xs={16} md={3}>
                          <Select
                            optionList={[
                              { label: t('方图'), value: 'square' },
                              { label: t('竖图'), value: 'portrait' },
                              { label: t('横图'), value: 'landscape' },
                            ]}
                            value={item.aspect}
                            onChange={(value) =>
                              updateGalleryItem(index, 'aspect', value)
                            }
                          />
                        </Col>
                        <Col xs={8} md={2}>
                          <Button
                            type='danger'
                            theme='borderless'
                            onClick={() =>
                              updateGalleryItems(
                                galleryItems.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              )
                            }
                          >
                            {t('删除')}
                          </Button>
                        </Col>
                        <Col xs={24}>
                          <TextArea
                            autosize={{ minRows: 2, maxRows: 4 }}
                            placeholder={t('提示词摘要')}
                            value={item.prompt}
                            onChange={(value) =>
                              updateGalleryItem(index, 'prompt', value)
                            }
                          />
                        </Col>
                      </Row>
                    </div>
                  ))
                )}
              </div>

              <div className='mt-4 flex flex-col gap-2'>
                <Text strong>{t('图集 JSON')}</Text>
                <TextArea
                  autosize={{ minRows: 5, maxRows: 10 }}
                  placeholder='[{"imageUrl":"https://...","title":"..."}]'
                  value={inputs.HomeGalleryImages}
                  onChange={(value) => {
                    updateInputs({ HomeGalleryImages: value });
                    setGalleryItems(parseGalleryImages(value));
                  }}
                />
              </div>
            </div>
            <Row>
              <Button size='default' onClick={onSubmit}>
                {t('保存绘图设置')}
              </Button>
            </Row>
          </Form.Section>
        </Form>
      </Spin>
    </>
  );
}
